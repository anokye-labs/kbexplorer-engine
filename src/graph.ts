/**
 * Graph engine: computes the knowledge graph from parsed nodes.
 * Builds edges, clusters, related nodes, and layout positions.
 */
import type { KBNode, KBGraph, KBEdge, Cluster } from '../types';

/** Build the full knowledge graph from a list of nodes and cluster definitions. */
export function buildGraph(nodes: KBNode[], clusters: Cluster[]): KBGraph {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edges = buildEdges(nodes, nodeMap);
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
    // Explicit connections from frontmatter / cross-references
    for (const conn of node.connections) {
      if (nodeMap.has(conn.to)) {
        const key = edgeKey(node.id, conn.to);
        if (!edgeSet.has(key)) {
          edgeSet.set(key, {
            from: node.id,
            to: conn.to,
            description: conn.description,
          });
        }
      }
    }

    // Parent → child edges
    if (node.parent && nodeMap.has(node.parent)) {
      const key = edgeKey(node.parent, node.id);
      if (!edgeSet.has(key)) {
        edgeSet.set(key, {
          from: node.parent,
          to: node.id,
          description: 'Contains',
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

/** Compute related nodes for each node (neighbors sorted by degree, max 8). */
function computeRelated(
  nodes: KBNode[],
  edges: KBEdge[]
): Record<string, string[]> {
  // Build adjacency list
  const adj = new Map<string, Set<string>>();
  for (const node of nodes) {
    adj.set(node.id, new Set());
  }
  for (const edge of edges) {
    adj.get(edge.from)?.add(edge.to);
    adj.get(edge.to)?.add(edge.from);
  }

  // Degree map for sorting
  const degree = new Map<string, number>();
  for (const [id, neighbors] of adj) {
    degree.set(id, neighbors.size);
  }

  const related: Record<string, string[]> = {};
  for (const [id, neighbors] of adj) {
    related[id] = [...neighbors]
      .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
      .slice(0, 8);
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

/** Find the hub node — the most-connected node in the graph. */
export function getHubNodeId(graph: KBGraph): string | null {
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
