import type { EdgeType, KnownEdgeType } from '@anokye-labs/kbexplorer-core';

/**
 * Edge-type weight table + lookup — governs relevance ranking for
 * `computeRelated` (in `./graph`) and default edge weights when a connection
 * doesn't specify its own.
 *
 * Provenance note (slice 1/5, anokye-labs/kbexplorer-template#472): in
 * kbexplorer-template this pure data + lookup function live inside
 * `src/representation/styles.ts` alongside DOM-touching style helpers (one
 * reads the live DOM's computed style), so that whole module can't move
 * into this runtime-agnostic engine package. These two exports are
 * extracted here **verbatim** (byte-identical values/logic, no behavior
 * change) since `graph.ts` — a slice-1 module — depends on them at runtime.
 * `representation/styles.ts` itself stays in template for now (its
 * DOM-dependent parts are out of scope for every slice of this migration so
 * far); flagged upstream in case the template side wants to re-export from
 * here instead of keeping a duplicate copy.
 */
export const EDGE_TYPE_WEIGHTS: Record<KnownEdgeType, number> = {
  contains: 5.0,
  derived_from: 3.0,
  imports: 2.0,
  references: 2.0,
  frontmatter: 1.5,
  cross_references: 1.5,
  modifies: 1.0,
  closes: 2.0,
  mentions: 0.5,
  related: 0.3,
};

/** Resolve the layout weight for an edge type (open-safe). */
export function getEdgeWeight(type: EdgeType | undefined): number {
  return EDGE_TYPE_WEIGHTS[(type ?? 'related') as KnownEdgeType] ?? 1;
}
