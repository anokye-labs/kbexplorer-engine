/**
 * Catalogue-pipeline helpers (anokye-labs/kbexplorer-engine#19, part of the
 * thin-CLI/fat-engine epic anokye-labs/kbexplorer-template#463). Faithful,
 * source-agnostic ports of kbexplorer-template's `scripts/derive-content.js`,
 * `scripts/compare-content.js`, and `scripts/enrich-context.js`.
 */
export type { Catalogue, CatalogueNode, CatalogueContentFiles } from './types';

export { deriveNeeds } from './derive-needs';
export type { DeriveNeedsNode, DeriveNeedsResult } from './derive-needs';

export { compareContent } from './compare-content';
export type { ClusterChange, LinkCountDiff, CompareContentResult } from './compare-content';

export { enrichFromManifest } from './enrich-from-manifest';
export type {
  RelatedIssue,
  RelatedPullRequest,
  RelatedCommit,
  EnrichedCatalogueNode,
  EnrichedCatalogue,
  EnrichFromManifestSummary,
  EnrichFromManifestResult,
} from './enrich-from-manifest';
