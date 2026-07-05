/**
 * Scriptable graph-query helpers (anokye-labs/kbexplorer-template#475).
 *
 * A small, pure, runtime-agnostic read API over a computed {@link KBGraph}.
 * These helpers are the scripting surface: given a graph (from
 * {@link loadKnowledgeBase} or {@link buildGraph}) they answer the common
 * questions — "get this node", "find nodes matching X", "who are its
 * neighbors", "what's related", "give me a neighborhood subgraph", "what's the
 * shortest path" — without any DOM, environment, or provider dependency.
 *
 * They deliberately *reuse* the graph's existing indices rather than
 * recomputing structure: {@link related} reads the precomputed
 * `graph.related` map, and callers who need node degrees should use
 * {@link getNodeDegrees} from `./graph` (this module never reimplements it).
 * The only structure built here is a lightweight, per-call adjacency map for
 * neighbor/path traversal, which the graph does not otherwise expose.
 */
import type { KBGraph, KBNode, KBEdge, EdgeType } from '@anokye-labs/kbexplorer-core';

/** Traversal direction over the directed edge set. */
export type Direction = 'out' | 'in' | 'both';

/** Options for {@link neighbors}. */
export interface NeighborOptions {
  /** Which edge directions to follow. Default `'both'`. */
  direction?: Direction;
  /** Restrict to one or more edge types (e.g. `'contains'`). Default: any type. */
  edgeType?: EdgeType | EdgeType[];
}

/** Options for {@link subgraph}. */
export interface SubgraphOptions {
  /** How many hops to expand out from the seed(s). Default `1`. */
  radius?: number;
  /** Which edge directions to follow while expanding. Default `'both'`. */
  direction?: Direction;
}

/** Options for {@link shortestPath}. */
export interface ShortestPathOptions {
  /** Which edge directions to follow. Default `'both'`. */
  direction?: Direction;
}

/** Look up a single node by id. Returns `undefined` when absent. */
export function getNode(graph: KBGraph, id: string): KBNode | undefined {
  return graph.nodes.find(n => n.id === id);
}

/**
 * Return every node the predicate accepts, in graph order. The predicate
 * receives each {@link KBNode} and returns whether to keep it.
 */
export function findNodes(graph: KBGraph, predicate: (node: KBNode) => boolean): KBNode[] {
  return graph.nodes.filter(predicate);
}

/** Normalize the optional `edgeType` option into a membership test. */
function edgeTypeMatcher(edgeType?: EdgeType | EdgeType[]): (type: EdgeType) => boolean {
  if (edgeType === undefined) return () => true;
  const set = new Set<EdgeType>(Array.isArray(edgeType) ? edgeType : [edgeType]);
  return type => set.has(type);
}

/**
 * Directly-connected neighbor nodes of `id`. Honors edge direction and an
 * optional edge-type filter. Unknown ids yield `[]`. Neighbor ids are
 * de-duplicated and returned in first-seen edge order; ids without a resolvable
 * node (e.g. dangling edge targets) are skipped.
 */
export function neighbors(graph: KBGraph, id: string, options: NeighborOptions = {}): KBNode[] {
  const direction = options.direction ?? 'both';
  const matchesType = edgeTypeMatcher(options.edgeType);
  const nodeById = indexNodes(graph);
  if (!nodeById.has(id)) return [];

  const seen = new Set<string>();
  const out: KBNode[] = [];
  const consider = (neighborId: string): void => {
    if (neighborId === id || seen.has(neighborId)) return;
    const node = nodeById.get(neighborId);
    if (!node) return;
    seen.add(neighborId);
    out.push(node);
  };

  for (const edge of graph.edges) {
    if (!matchesType(edge.type)) continue;
    if ((direction === 'out' || direction === 'both') && edge.from === id) consider(edge.to);
    if ((direction === 'in' || direction === 'both') && edge.to === id) consider(edge.from);
  }
  return out;
}

/**
 * Related nodes for `id`, using the graph's precomputed `related` index
 * (weight-ranked at build time). Ids in the index that no longer resolve to a
 * node are skipped. Unknown ids yield `[]`.
 */
export function related(graph: KBGraph, id: string): KBNode[] {
  const nodeById = indexNodes(graph);
  const relatedIds = graph.related[id] ?? [];
  const out: KBNode[] = [];
  for (const relatedId of relatedIds) {
    const node = nodeById.get(relatedId);
    if (node) out.push(node);
  }
  return out;
}

/**
 * Extract the neighborhood {@link KBGraph} around one or more seed nodes,
 * expanded `radius` hops. The result is a well-formed graph: `nodes` are the
 * reachable set, `edges` are only those whose endpoints are both kept,
 * `clusters` are filtered to those actually used, and `related` is rebuilt to
 * reference only kept nodes. Unknown seeds contribute nothing.
 */
export function subgraph(graph: KBGraph, seeds: string | string[], options: SubgraphOptions = {}): KBGraph {
  const radius = options.radius ?? 1;
  const direction = options.direction ?? 'both';
  const nodeById = indexNodes(graph);
  const adjacency = buildAdjacency(graph.edges, direction);

  const kept = new Set<string>();
  let frontier: string[] = [];
  for (const seed of Array.isArray(seeds) ? seeds : [seeds]) {
    if (nodeById.has(seed) && !kept.has(seed)) {
      kept.add(seed);
      frontier.push(seed);
    }
  }

  for (let hop = 0; hop < radius && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const neighborId of adjacency.get(current) ?? []) {
        if (!kept.has(neighborId)) {
          kept.add(neighborId);
          next.push(neighborId);
        }
      }
    }
    frontier = next;
  }

  const nodes = graph.nodes.filter(n => kept.has(n.id));
  const edges = graph.edges.filter(e => kept.has(e.from) && kept.has(e.to));

  const usedClusters = new Set(nodes.map(n => n.cluster));
  const clusters = graph.clusters.filter(c => usedClusters.has(c.id));

  const relatedOut: Record<string, string[]> = {};
  for (const node of nodes) {
    const filtered = (graph.related[node.id] ?? []).filter(rid => kept.has(rid));
    if (filtered.length > 0) relatedOut[node.id] = filtered;
  }

  return { nodes, edges, clusters, related: relatedOut };
}

/**
 * Breadth-first shortest path between two node ids, returned as the inclusive
 * list of node ids from `from` to `to` (length 1 when `from === to`). Returns
 * `null` when either endpoint is unknown or no path exists. `direction`
 * controls how edges may be traversed.
 */
export function shortestPath(
  graph: KBGraph,
  from: string,
  to: string,
  options: ShortestPathOptions = {},
): string[] | null {
  const direction = options.direction ?? 'both';
  const nodeById = indexNodes(graph);
  if (!nodeById.has(from) || !nodeById.has(to)) return null;
  if (from === to) return [from];

  const adjacency = buildAdjacency(graph.edges, direction);
  const previous = new Map<string, string>();
  const visited = new Set<string>([from]);
  const queue: string[] = [from];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighborId of adjacency.get(current) ?? []) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      previous.set(neighborId, current);
      if (neighborId === to) {
        return reconstructPath(previous, from, to);
      }
      queue.push(neighborId);
    }
  }
  return null;
}

/** Build (once per call) a node-id → node lookup map. */
function indexNodes(graph: KBGraph): Map<string, KBNode> {
  const byId = new Map<string, KBNode>();
  for (const node of graph.nodes) byId.set(node.id, node);
  return byId;
}

/**
 * Build a direction-aware adjacency map (node id → set of neighbor ids) for
 * traversal. This is the one structure the graph doesn't already expose; it is
 * intentionally not derived from {@link getNodeDegrees}, which answers a
 * different question (per-node degree counts).
 */
function buildAdjacency(edges: KBEdge[], direction: Direction): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    let set = adjacency.get(a);
    if (!set) {
      set = new Set<string>();
      adjacency.set(a, set);
    }
    set.add(b);
  };
  for (const edge of edges) {
    if (direction === 'out' || direction === 'both') link(edge.from, edge.to);
    if (direction === 'in' || direction === 'both') link(edge.to, edge.from);
  }
  return adjacency;
}

/** Walk the BFS predecessor map back into an ordered `from → to` id list. */
function reconstructPath(previous: Map<string, string>, from: string, to: string): string[] {
  const path: string[] = [to];
  let cursor = to;
  while (cursor !== from) {
    const prev = previous.get(cursor);
    if (prev === undefined) return [];
    path.push(prev);
    cursor = prev;
  }
  path.reverse();
  return path;
}
