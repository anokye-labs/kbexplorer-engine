/**
 * `assessGraph` — non-gating quality scoring + actionable suggestions over
 * the engine's authored-content graph, ported faithfully from kbexplorer-
 * template's `scripts/assess-graph.js` (anokye-labs/kbexplorer-engine#18,
 * epic anokye-labs/kbexplorer-template#463).
 *
 * See `./graph-analysis-shared` for why this walks the narrow inline-link
 * graph directly instead of the fully-computed `KBGraph` from `buildGraph`.
 */
import type { RepoManifest } from './sources/repo-manifest';
import { parseAuthoredEntries } from './graph-analysis-shared';

/** Inputs `assessGraph` needs — a subset of the fields `buildManifest` already produces. */
export type GraphAssessmentInput = Pick<RepoManifest, 'authoredContent'>;

/** Readability/structure limits, verbatim from the template script's `LIMITS`. */
const LIMITS = {
  nodesPerView: 40,
  edgesPerView: 80,
  maxClusters: 8,
  maxHubHops: 3,
  highOutDegree: 15,
} as const;

/** `--gate` mode minimum scores, verbatim from the template script's `MIN_SCORES`. */
const MIN_SCORES = {
  connectivity: 50,
  clusterBalance: 30,
  density: 30,
  bidirectionality: 20,
  contentDepth: 60,
} as const;

export interface QualityScores {
  connectivity: number;
  /**
   * Defaults to 100 ("perfect balance") when fewer than 2 clusters exist —
   * verbatim from the script's `let clusterBalanceScore = 100` default,
   * which is what still feeds `--gate` scoring even though the human log
   * prints "N/A" in that case. See {@link AssessmentResult.scoreDetails}'s
   * `clusterBalanceApplicable` for the "N/A" distinction.
   */
  clusterBalance: number;
  density: number;
  bidirectionality: number;
  contentDepth: number;
}

export interface GraphAssessmentConstraint {
  value: number;
  limit: number;
  ok: boolean;
}

export interface HubReachability {
  hubId: string | null;
  maxHops: number;
  unreachable: string[];
}

export interface GraphAssessmentGate {
  pass: boolean;
  failures: Array<{ metric: keyof QualityScores; actual: number; minimum: number }>;
}

export interface AssessmentResult {
  summary: { nodeCount: number; edgeCount: number; clusterCount: number };
  constraints: {
    nodeCount: GraphAssessmentConstraint;
    edgeCount: GraphAssessmentConstraint;
    clusterCount: GraphAssessmentConstraint;
    /** Node ids with zero incoming links — includes one entry per authored file, so a duplicated id can appear more than once (matches the script). */
    orphanNodes: string[];
    hubReachability: HubReachability;
  };
  scores: QualityScores;
  /** The raw stats each score in {@link scores} was derived from. */
  scoreDetails: {
    avgLinksPerNode: number;
    clusterSizes: number[];
    /** `null` when fewer than 2 clusters exist (no standard deviation to report). */
    clusterStdDev: number | null;
    /** `true` iff 2+ clusters exist, i.e. `clusterBalance`/`clusterStdDev` reflect a real computation rather than the N/A default. */
    clusterBalanceApplicable: boolean;
    density: number;
    bidirectionalPct: number;
    avgContentLength: number;
  };
  suggestions: string[];
  /** Present only when `options.gate` is requested — mirrors `node scripts/assess-graph.js --gate`. */
  gate?: GraphAssessmentGate;
}

export interface AssessGraphOptions {
  /** When true, also evaluates the `--gate` minimum-score thresholds and populates {@link AssessmentResult.gate}. */
  gate?: boolean;
}

function clamp100(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** BFS from a start node over an undirected adjacency map, returning hop distances. */
function bfsDistances(adjacency: Map<string, Set<string>>, startId: string): Map<string, number> {
  const distances = new Map<string, number>([[startId, 0]]);
  const queue: string[] = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const d = distances.get(current)!;
    for (const neighbour of adjacency.get(current) ?? []) {
      if (!distances.has(neighbour)) {
        distances.set(neighbour, d + 1);
        queue.push(neighbour);
      }
    }
  }
  return distances;
}

/**
 * Assess quality of the authored-content graph: readability constraints
 * (node/edge/cluster counts, orphans, hub reachability), five 0-100 quality
 * scores (connectivity, cluster balance, link density, bidirectionality,
 * content depth), and actionable suggestions. Always non-gating unless the
 * caller opts into `options.gate` and checks the returned `gate.pass`.
 */
export function assessGraph(input: GraphAssessmentInput, options: AssessGraphOptions = {}): AssessmentResult {
  const entries = parseAuthoredEntries(input.authoredContent);
  const nodeIds = new Set(entries.map(e => e.id));

  const edges: Array<{ from: string; to: string }> = [];
  for (const entry of entries) {
    for (const target of entry.links) {
      if (nodeIds.has(target)) edges.push({ from: entry.id, to: target });
    }
  }

  const clusterMap = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.cluster) {
      if (!clusterMap.has(entry.cluster)) clusterMap.set(entry.cluster, []);
      clusterMap.get(entry.cluster)!.push(entry.id);
    }
  }

  const nodeCount = entries.length;
  const edgeCount = edges.length;
  const clusterCount = clusterMap.size;

  const outDegree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  for (const id of nodeIds) {
    outDegree.set(id, 0);
    inDegree.set(id, 0);
    adjacency.set(id, new Set());
  }
  for (const e of edges) {
    outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    adjacency.get(e.from)!.add(e.to);
    adjacency.get(e.to)!.add(e.from);
  }

  // ── Constraints ────────────────────────────────────────────
  const nodeCountConstraint: GraphAssessmentConstraint = {
    value: nodeCount,
    limit: LIMITS.nodesPerView,
    ok: nodeCount <= LIMITS.nodesPerView,
  };
  const edgeCountConstraint: GraphAssessmentConstraint = {
    value: edgeCount,
    limit: LIMITS.edgesPerView,
    ok: edgeCount <= LIMITS.edgesPerView,
  };
  const clusterCountConstraint: GraphAssessmentConstraint = {
    value: clusterCount,
    limit: LIMITS.maxClusters,
    ok: clusterCount <= LIMITS.maxClusters,
  };

  const orphans: string[] = [];
  for (const entry of entries) {
    if ((inDegree.get(entry.id) ?? 0) === 0) orphans.push(entry.id);
  }

  // Hub = highest total (out + in) degree node, defaulting to the first entry.
  let hubId: string | null = entries[0]?.id ?? null;
  let hubDegree = 0;
  for (const entry of entries) {
    const total = (outDegree.get(entry.id) ?? 0) + (inDegree.get(entry.id) ?? 0);
    if (total > hubDegree) {
      hubDegree = total;
      hubId = entry.id;
    }
  }

  let maxHops = 0;
  const unreachable: string[] = [];
  const distances = hubId !== null ? bfsDistances(adjacency, hubId) : new Map<string, number>();
  for (const id of nodeIds) {
    if (!distances.has(id)) unreachable.push(id);
    else maxHops = Math.max(maxHops, distances.get(id)!);
  }

  // ── Quality scores ─────────────────────────────────────────

  // 1. Connectivity — avg inline links per node, target 4-8.
  const avgLinksPerNode = nodeCount > 0 ? edgeCount / nodeCount : 0;
  let connectivityScore: number;
  if (avgLinksPerNode >= 4 && avgLinksPerNode <= 8) {
    connectivityScore = 100;
  } else if (avgLinksPerNode < 4) {
    connectivityScore = clamp100((avgLinksPerNode / 4) * 100);
  } else {
    connectivityScore = clamp100(100 - ((avgLinksPerNode - 8) / 8) * 50);
  }

  // 2. Cluster balance — std deviation of cluster sizes (100 default when N/A).
  const clusterSizes = [...clusterMap.values()].map(members => members.length);
  const clusterBalanceApplicable = clusterSizes.length > 1;
  let clusterBalanceScore = 100;
  let clusterStdDev: number | null = null;
  if (clusterBalanceApplicable) {
    const mean = clusterSizes.reduce((a, b) => a + b, 0) / clusterSizes.length;
    const variance = clusterSizes.reduce((s, v) => s + (v - mean) ** 2, 0) / clusterSizes.length;
    clusterStdDev = Math.sqrt(variance);
    clusterBalanceScore = clamp100(100 - clusterStdDev * 15);
  }

  // 3. Link density — edges / max-possible-edges, ideal range 0.1-0.3.
  const maxEdges = nodeCount > 1 ? (nodeCount * (nodeCount - 1)) / 2 : 1;
  const density = edgeCount / maxEdges;
  let densityScore: number;
  if (density >= 0.1 && density <= 0.3) {
    densityScore = 100;
  } else if (density < 0.1) {
    densityScore = clamp100((density / 0.1) * 100);
  } else {
    densityScore = clamp100(100 - ((density - 0.3) / 0.7) * 100);
  }

  // 4. Bidirectionality — % of edges with a reverse edge present.
  const edgeSet = new Set(edges.map(e => `${e.from}\u2192${e.to}`));
  let reciprocalCount = 0;
  for (const e of edges) {
    if (edgeSet.has(`${e.to}\u2192${e.from}`)) reciprocalCount++;
  }
  const bidirectionalPct = edgeCount > 0 ? (reciprocalCount / edgeCount) * 100 : 0;
  const bidirectionalityScore = clamp100(bidirectionalPct);

  // 5. Content depth — avg body length per node, target ~1000 chars.
  const avgContentLength = nodeCount > 0 ? entries.reduce((sum, e) => sum + e.body.length, 0) / nodeCount : 0;
  const contentDepthScore = clamp100((avgContentLength / 1000) * 100);

  const scores: QualityScores = {
    connectivity: connectivityScore,
    clusterBalance: clusterBalanceScore,
    density: densityScore,
    bidirectionality: bidirectionalityScore,
    contentDepth: contentDepthScore,
  };

  // ── Suggestions ────────────────────────────────────────────
  const suggestions: string[] = [];

  for (const id of orphans) {
    suggestions.push(`Node "${id}" has 0 incoming links — add a reference from a parent node`);
  }

  for (const [cluster, members] of clusterMap) {
    if (members.length > LIMITS.maxClusters + 1) {
      suggestions.push(`Cluster "${cluster}" has ${members.length} nodes — consider splitting into sub-clusters`);
    }
  }

  for (const entry of entries) {
    const out = outDegree.get(entry.id) ?? 0;
    if (out >= LIMITS.highOutDegree) {
      suggestions.push(`Node "${entry.id}" has ${out} outgoing links — consider splitting into focused sub-nodes`);
    }
  }

  const titleMap = new Map<string, string[]>();
  for (const entry of entries) {
    const t = (entry.title || '').toLowerCase();
    if (!titleMap.has(t)) titleMap.set(t, []);
    titleMap.get(t)!.push(entry.id);
  }
  for (const [title, ids] of titleMap) {
    if (ids.length > 1) {
      suggestions.push(`Nodes ${ids.join(' and ')} have identical title "${title}" — possible duplicate`);
    }
  }

  if (edgeCount > LIMITS.edgesPerView) {
    suggestions.push(`Edge count ${edgeCount} exceeds ${LIMITS.edgesPerView}-edge readability limit — use layer views`);
  }
  if (nodeCount > LIMITS.nodesPerView) {
    suggestions.push(`Node count ${nodeCount} exceeds ${LIMITS.nodesPerView}-node readability limit — use layer views`);
  }

  const result: AssessmentResult = {
    summary: { nodeCount, edgeCount, clusterCount },
    constraints: {
      nodeCount: nodeCountConstraint,
      edgeCount: edgeCountConstraint,
      clusterCount: clusterCountConstraint,
      orphanNodes: orphans,
      hubReachability: { hubId, maxHops, unreachable },
    },
    scores,
    scoreDetails: {
      avgLinksPerNode,
      clusterSizes,
      clusterStdDev,
      clusterBalanceApplicable,
      density,
      bidirectionalPct,
      avgContentLength,
    },
    suggestions,
  };

  // ── CI gate mode (`--gate`) ────────────────────────────────
  if (options.gate) {
    const failures: GraphAssessmentGate['failures'] = [];
    for (const metric of Object.keys(MIN_SCORES) as Array<keyof QualityScores>) {
      const minimum = MIN_SCORES[metric];
      const actual = scores[metric];
      if (actual < minimum) failures.push({ metric, actual, minimum });
    }
    result.gate = { pass: failures.length === 0, failures };
  }

  return result;
}
