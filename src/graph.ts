/**
 * Graph engine: computes the knowledge graph from parsed nodes.
 * Builds edges, clusters, related nodes, and layout positions.
 */
import type { KBNode, KBGraph, KBEdge, Cluster, EdgeType } from '@anokye-labs/kbexplorer-core';
import { EDGE_TYPE_WEIGHTS, getEdgeWeight } from './edge-weights';
import { filterAccessWithheld } from './access';
import { resolveNodeLayer } from './node-types/registry';

/**
 * Build the full knowledge graph from a list of nodes and cluster definitions.
 *
 * Access render-gate (#445): nodes whose access label marks them
 * restricted/confidential (or explicitly unknown, or `visibility: private`)
 * are withheld here — the single assembly choke point — so they never reach
 * the network render, reading views, search index, or exports. Edges to a
 * withheld node drop with it (`buildEdges` only emits edges whose target is
 * in the node map). Unlabeled nodes are untouched.
 */
export function buildGraph(nodes: KBNode[], clusters: Cluster[]): KBGraph {
  nodes = filterAccessWithheld(nodes);
  for (const node of nodes) {
    node.layer = resolveNodeLayer(node);
  }
  // AF-019 cheap slice (#445): a cross-provider id collision is silent data
  // loss — the node map last-wins, so edges/related resolve to whichever node
  // happened to come later while both stay in `nodes`. Make it observable.
  const nodeMap = new Map<string, KBNode>();
  for (const n of nodes) {
    const prev = nodeMap.get(n.id);
    if (prev && (prev.provider ?? '(none)') !== (n.provider ?? '(none)')) {
      console.warn(
        `[kbexplorer] cross-provider id collision: "${n.id}" is produced by ` +
        `provider "${prev.provider ?? '(none)'}" and provider "${n.provider ?? '(none)'}" — ` +
        `edge/related resolution will last-win on the latter. Give one a distinct id.`,
      );
    }
    nodeMap.set(n.id, n);
  }
  const edges = buildEdges(nodes, nodeMap);

  // Connect orphan nodes to a cluster sibling or the hub
  const connected = new Set<string>();
  for (const e of edges) { connected.add(e.from); connected.add(e.to); }
  const orphans = nodes.filter(n => !connected.has(n.id));
  if (orphans.length > 0) {
    // Find hub (most-connected node)
    const degrees = new Map<string, number>();
    for (const n of nodes) degrees.set(n.id, 0);
    for (const e of edges) {
      degrees.set(e.from, (degrees.get(e.from) ?? 0) + 1);
      degrees.set(e.to, (degrees.get(e.to) ?? 0) + 1);
    }
    let hubId = nodes[0]?.id;
    let hubDeg = 0;
    for (const [id, deg] of degrees) {
      if (deg > hubDeg) { hubDeg = deg; hubId = id; }
    }

    for (const orphan of orphans) {
      // Try to find a same-cluster node that's already connected
      const sibling = nodes.find(n => n.id !== orphan.id && n.cluster === orphan.cluster && connected.has(n.id));
      const targetId = sibling?.id ?? hubId;
      // Never emit a self-loop. In an all-orphan graph (e.g. a content-only
      // FileSystemSource build where every authored node's only connection is a
      // suppressed `derived_from` file-tree edge) the hub degenerates to the
      // first node, which may be the orphan itself — reconnecting it to itself
      // would produce a spurious `X -related-> X` edge. Leave such a node
      // unconnected instead; a later orphan can still anchor to it as the hub.
      if (targetId && targetId !== orphan.id) {
        edges.push({ from: targetId, to: orphan.id, type: 'related', description: 'Related', source: 'inferred', weight: EDGE_TYPE_WEIGHTS.related });
        connected.add(orphan.id);
      }
    }
  }

  const related = computeRelated(nodes, edges);
  return { nodes, edges, clusters, related };
}

/** Build edges from node connections + parent/child links. */
function buildEdges(
  nodes: KBNode[],
  nodeMap: Map<string, KBNode>
): KBEdge[] {
  const edgeSet = new Map<string, KBEdge>();
  const addEdge = (edge: KBEdge): void => {
    const key = edgeKey(edge);
    if (!edgeSet.has(key)) {
      edgeSet.set(key, edge);
    }
  };

  for (const node of nodes) {
    for (const conn of node.connections) {
      if (nodeMap.has(conn.to)) {
        const edgeType: EdgeType = conn.type ?? 'references';
        addEdge({
          from: node.id,
          to: conn.to,
          type: edgeType,
          description: conn.description,
          source: conn.source ?? 'frontmatter',
          weight: conn.weight ?? getEdgeWeight(edgeType),
          ...(conn.relation ? { relation: conn.relation } : {}),
        });
      }
    }

    // Parent → child edges (strong containment)
    if (node.parent && nodeMap.has(node.parent)) {
      addEdge({
        from: node.parent,
        to: node.id,
        type: 'contains',
        description: 'Contains',
        source: 'inferred',
        weight: EDGE_TYPE_WEIGHTS.contains,
      });
    }
  }

  return [...edgeSet.values()];
}

/** Directed semantic edge key for deduplication. */
function edgeKey(edge: Pick<KBEdge, 'from' | 'to' | 'type' | 'relation'>): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.type}\u0000${edge.relation ?? ''}`;
}

/** Compute related nodes for each node, ranked by edge weight. */
function computeRelated(
  nodes: KBNode[],
  edges: KBEdge[]
): Record<string, string[]> {
  // Build adjacency with edge weights
  const adj = new Map<string, Map<string, number>>();
  for (const node of nodes) {
    adj.set(node.id, new Map());
  }
  for (const edge of edges) {
    const fwd = adj.get(edge.from);
    const rev = adj.get(edge.to);
    // Keep the highest weight if multiple edges exist between same pair
    if (fwd && (!fwd.has(edge.to) || edge.weight > (fwd.get(edge.to) ?? 0))) {
      fwd.set(edge.to, edge.weight);
    }
    if (rev && (!rev.has(edge.from) || edge.weight > (rev.get(edge.from) ?? 0))) {
      rev.set(edge.from, edge.weight);
    }
  }

  // Degree map for tie-breaking
  const degree = new Map<string, number>();
  for (const [id, neighbors] of adj) {
    degree.set(id, neighbors.size);
  }

  const related: Record<string, string[]> = {};
  for (const [id, neighbors] of adj) {
    related[id] = [...neighbors.entries()]
      .sort((a, b) => {
        // Primary: edge weight (higher = more relevant)
        const weightDiff = b[1] - a[1];
        if (Math.abs(weightDiff) > 0.01) return weightDiff;
        // Secondary: target degree (higher = more connected)
        return (degree.get(b[0]) ?? 0) - (degree.get(a[0]) ?? 0);
      })
      .map(([neighborId]) => neighborId)
      .slice(0, 12);
  }

  return related;
}

/** Get the degree (connection count) of each node. */
export function getNodeDegrees(graph: KBGraph): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const node of graph.nodes) {
    degrees.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
    degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
  }
  return degrees;
}

/** Find the hub node — prefer 'home', then 'readme', then 'overview', then most-connected. */
export function getHubNodeId(graph: KBGraph): string | null {
  if (graph.nodes.some(n => n.id === 'home')) return 'home';
  if (graph.nodes.some(n => n.id === 'readme')) return 'readme';
  if (graph.nodes.some(n => n.id === 'overview')) return 'overview';
  const degrees = getNodeDegrees(graph);
  let bestId: string | null = null;
  let bestDeg = -1;
  for (const [id, deg] of degrees) {
    if (deg > bestDeg) { bestDeg = deg; bestId = id; }
  }
  return bestId;
}

/** Find the edge description between two nodes. */
export function getEdgeDescription(
  graph: KBGraph,
  from: string,
  to: string
): string | undefined {
  return graph.edges.find(
    e => (e.from === from && e.to === to) || (e.from === to && e.to === from)
  )?.description;
}

// ── Viewport trimming ──────────────────────────────────────
//
// Provenance note (slice 1/5, anokye-labs/kbexplorer-template#472):
// `trimGraphToLimits` (+ its `MAX_VISIBLE_NODES`/`MAX_VISIBLE_EDGES`/
// `TrimResult` companions) is pure `KBGraph` viewport-limiting logic that
// lived in kbexplorer-template's `src/types/index.ts` rather than its
// `src/engine/graph.ts` — but it operates only on `KBGraph` (no DOM, no env
// reads), it's tested alongside the rest of this file's graph-building logic
// in `__tests__/graph.test.ts`, and it's also used by a UI component
// (`HUD.tsx`, out of scope). Extracted here **verbatim** (byte-identical),
// since graph-viewport concerns belong naturally next to `buildGraph`.

/** Hard visibility limits for the rendered graph. */
export const MAX_VISIBLE_NODES = 40;
export const MAX_VISIBLE_EDGES = 80;

export interface TrimResult {
  graph: KBGraph;
  trimmed: boolean;
  totalNodes: number;
  totalEdges: number;
}

/**
 * Cap graph to MAX_VISIBLE_NODES / MAX_VISIBLE_EDGES.
 * Selection strategy:
 * 1. Always keep the hub node and current node
 * 2. Reserve 1-hop neighbors of the current node
 * 3. Ensure at least 1 node per cluster (cluster floor)
 * 4. Fill remaining slots by degree (most connected first)
 * 5. After node trim, cap edges — prefer current-node edges, then by weight
 */
export function trimGraphToLimits(
  graph: KBGraph,
  currentNodeId?: string | null,
  maxNodes = MAX_VISIBLE_NODES,
  maxEdges = MAX_VISIBLE_EDGES,
): TrimResult {
  const totalNodes = graph.nodes.length;
  const totalEdges = graph.edges.length;

  if (totalNodes <= maxNodes && totalEdges <= maxEdges) {
    return { graph, trimmed: false, totalNodes, totalEdges };
  }

  // Build degree map
  const degree = new Map<string, number>();
  for (const n of graph.nodes) degree.set(n.id, 0);
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  // Find hub
  let hubId: string | null = null;
  let hubDeg = -1;
  for (const [id, d] of degree) {
    if (d > hubDeg) { hubId = id; hubDeg = d; }
  }
  // Prefer home/readme/overview as hub
  if (graph.nodes.some(n => n.id === 'home')) hubId = 'home';
  else if (graph.nodes.some(n => n.id === 'readme')) hubId = 'readme';
  else if (graph.nodes.some(n => n.id === 'overview')) hubId = 'overview';

  const kept = new Set<string>();

  // 1. Hub + current node + readme (always visible)
  if (hubId) kept.add(hubId);
  if (currentNodeId && degree.has(currentNodeId)) kept.add(currentNodeId);
  if (graph.nodes.some(n => n.id === 'readme')) kept.add('readme');

  // 2. Current node's 1-hop neighbors
  if (currentNodeId) {
    const neighbors: { id: string; deg: number }[] = [];
    for (const e of graph.edges) {
      if (e.from === currentNodeId && degree.has(e.to)) neighbors.push({ id: e.to, deg: degree.get(e.to)! });
      if (e.to === currentNodeId && degree.has(e.from)) neighbors.push({ id: e.from, deg: degree.get(e.from)! });
    }
    neighbors.sort((a, b) => b.deg - a.deg);
    const neighborBudget = Math.min(Math.floor(maxNodes * 0.3), neighbors.length);
    for (let i = 0; i < neighborBudget; i++) kept.add(neighbors[i]!.id);
  }

  // 3. Cluster floor — at least 1 node per cluster
  const clusters = new Set(graph.nodes.map(n => n.cluster).filter(Boolean));
  for (const cid of clusters) {
    if ([...kept].some(id => graph.nodes.find(n => n.id === id)?.cluster === cid)) continue;
    // Pick highest-degree node from this cluster
    const best = graph.nodes
      .filter(n => n.cluster === cid)
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0];
    if (best && kept.size < maxNodes) kept.add(best.id);
  }

  // 4. External provider boost — reserve slots for external nodes proportional to budget
  const externalNodes = graph.nodes.filter(n => n.source.type === 'external');
  if (externalNodes.length > 0) {
    // Reserve up to 20% of budget for external nodes (at least 2)
    const externalBudget = Math.max(2, Math.floor(maxNodes * 0.2));
    const externalToAdd = externalNodes
      .filter(n => !kept.has(n.id))
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
    for (const n of externalToAdd) {
      if (kept.size >= maxNodes) break;
      const externalKept = [...kept].filter(id =>
        graph.nodes.find(nd => nd.id === id)?.source.type === 'external'
      ).length;
      if (externalKept >= externalBudget) break;
      kept.add(n.id);
    }
  }

  // 5. Fill remaining by degree
  const byDegree = [...graph.nodes]
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
  for (const n of byDegree) {
    if (kept.size >= maxNodes) break;
    kept.add(n.id);
  }

  // Build trimmed node list
  const nodes = graph.nodes.filter(n => kept.has(n.id));

  // Keep ALL edges between visible nodes (no edge cap — visual importance handles density)
  const edges = graph.edges.filter(e => kept.has(e.from) && kept.has(e.to));

  // Rebuild related
  const nodeIdSet = new Set(nodes.map(n => n.id));
  const related: Record<string, string[]> = {};
  for (const id of nodeIdSet) {
    const r = (graph.related[id] ?? []).filter(rid => nodeIdSet.has(rid));
    if (r.length > 0) related[id] = r;
  }

  return {
    graph: { nodes, edges, clusters: graph.clusters, related },
    trimmed: true,
    totalNodes,
    totalEdges,
  };
}
