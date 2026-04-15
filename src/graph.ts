/**
 * Graph engine: computes the knowledge graph from parsed nodes.
 * Builds edges, clusters, related nodes, and layout positions.
 */
import type { KBNode, KBGraph, KBEdge, Cluster, EdgeType } from '../types';
import { EDGE_TYPE_WEIGHTS } from '../types';

/** Build the full knowledge graph from a list of nodes and cluster definitions. */
export function buildGraph(nodes: KBNode[], clusters: Cluster[]): KBGraph {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
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
      if (targetId) {
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

  for (const node of nodes) {
    for (const conn of node.connections) {
      if (nodeMap.has(conn.to)) {
        const key = edgeKey(node.id, conn.to);
        if (!edgeSet.has(key)) {
          const edgeType: EdgeType = conn.type ?? 'references';
          edgeSet.set(key, {
            from: node.id,
            to: conn.to,
            type: edgeType,
            description: conn.description,
            source: conn.source ?? 'frontmatter',
            weight: conn.weight ?? EDGE_TYPE_WEIGHTS[edgeType] ?? 1,
          });
        }
      }
    }

    // Parent → child edges (strong containment)
    if (node.parent && nodeMap.has(node.parent)) {
      const key = edgeKey(node.parent, node.id);
      if (!edgeSet.has(key)) {
        edgeSet.set(key, {
          from: node.parent,
          to: node.id,
          type: 'contains',
          description: 'Contains',
          source: 'inferred',
          weight: EDGE_TYPE_WEIGHTS.contains,
        });
      }
    }
  }

  return [...edgeSet.values()];
}

/** Canonical edge key for deduplication. */
function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
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
