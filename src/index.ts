/**
 * Public API — slices 1-2/5 of the kbexplorer-template → kbexplorer-engine
 * migration (anokye-labs/kbexplorer-template#472, epic #463).
 *
 * This mirrors the shape of template's `src/engine/index.ts` barrel, limited
 * to the symbols originating from the modules that have moved so far
 * (parser/identity pipeline core + node-types from slice 1; providers +
 * content-model + the external-provider plugin loader from slice 2; the pipeline
 * orchestrator + unified loader, plus the sources/store forward-dependencies
 * needed to compile it, from slice 3).
 * `loadAuthoredContent`, `loadRepoContent`, and `loadConfig` are intentionally
 * NOT exported here: their bodies were removed from `./parser` in slice 1
 * because they depend on the live GitHub client, which doesn't move until
 * slice 4.
 */

// -- graph.ts ---------------------------------------------------------------
export {
  buildGraph,
  getNodeDegrees,
  getHubNodeId,
  getEdgeDescription,
  trimGraphToLimits,
  MAX_VISIBLE_NODES,
  MAX_VISIBLE_EDGES,
} from './graph';
export type { TrimResult } from './graph';

// -- edge-weights.ts ----------------------------------------------------------
export { EDGE_TYPE_WEIGHTS, getEdgeWeight } from './edge-weights';

// -- query.ts (scriptable graph-query helpers; template#475) ------------------
export {
  getNode,
  findNodes,
  neighbors,
  related,
  subgraph,
  shortestPath,
} from './query';
export type {
  Direction,
  NeighborOptions,
  SubgraphOptions,
  ShortestPathOptions,
} from './query';

// -- parser.ts ----------------------------------------------------------------
// Slice 4/5: loadAuthoredContent / loadRepoContent / loadConfig now land here —
// the GitHub client they depend on migrated to ./github-client this slice.
export {
  parseMarkdownFile,
  issueToNode,
  treeToNodes,
  extractIssueRefs,
  splitIntoSections,
  extractClusters,
  loadAuthoredContent,
  loadRepoContent,
  loadConfig,
} from './parser';
export type { IssueToNodeOptions } from './parser';

// -- github-types.ts ----------------------------------------------------------
export type { GHIssue, GHTreeItem, GHRelease, GHCommit } from './github-types';

// -- github-client.ts ---------------------------------------------------------
export type { CacheStore, GHFileContent } from './github-client';
export { fetchFile, fetchTree, fetchIssues, fetchPullRequests, fetchCommits, fetchReleases, fetchFiles } from './github-client';

// -- default-config.ts ---------------------------------------------------------
export { DEFAULT_CONFIG } from './default-config';

// -- nodemap.ts -----------------------------------------------------------------
export { loadNodeMap, extractImportPaths, resolveImportPath } from './nodemap';
export type { NodeMapEntry, NodeMap } from './nodemap';

// -- identity.ts ------------------------------------------------------------
export { assignIdentity, shareIdentity, buildIdentityIndex, urnIdentity, urnBody } from './identity';

// -- structured-node-map.ts ---------------------------------------------------
export {
  applyStructuredNodeMap,
  inferStructuredNode,
  parseStructuredNodeMap,
  parseStructuredContent,
  reconstructSource,
  slugify,
} from './structured-node-map';
export type { StructuredFile, StructuredNodeMap, NodeMapRule } from './structured-node-map';

// -- structured-content.ts ---------------------------------------------------
export {
  DEFAULT_STRUCTURED_CONTENT_PATH,
  normalizeRepoRelativeDir,
  resolveStructuredContentPath,
  hasExplicitStructuredContentPath,
} from './structured-content';
export type { StructuredContentConfig } from './structured-content';

// -- source-edit.ts -----------------------------------------------------------
export {
  canEditSource,
  resolveSourceFile,
  validateSourceContent,
  repoCoordsFromConfig,
  encodeRepoPath,
  buildEditUrl,
  buildNewFileUrl,
  buildHandoffUrl,
  buildUnifiedDiff,
  patchFilename,
  buildSourceEditHandoff,
  normalizeNewlines,
} from './source-edit';
export type { RepoCoords, ValidationResult, SourceEditHandoff } from './source-edit';

// -- access.ts ----------------------------------------------------------------
export { isAccessWithheld, filterAccessWithheld, parseAccessLabel } from './access';

// -- transforms.ts --------------------------------------------------------------
export {
  readmeTransform,
  issueDirectoryLinkTransform,
  issueSplitTransform,
  DEFAULT_TRANSFORMS,
  applyTransforms,
} from './transforms';
export type { TransformContext, GraphTransform } from './transforms';

// -- safe-markdown.ts -----------------------------------------------------------
export { renderSafeMarkdown } from './safe-markdown';

// -- glob.ts --------------------------------------------------------------------
export { globToRegex } from './glob';

// -- env.ts -----------------------------------------------------------------------
export type { EngineEnv } from './env';

// -- node-types/ ------------------------------------------------------------------
export {
  registerType,
  resolveType,
  hasType,
  getRegisteredTypes,
  registerBuiltInNodeTypes,
  resetNodeTypeRegistry,
  resolveNodeLayer,
  resolveTypeCluster,
} from './node-types';
export type { NodeTypeDefinition, NodeLayer } from './node-types';

// -- providers.ts (ProviderRegistry) -----------------------------------------
export { ProviderRegistry } from './providers';
export type { GraphProvider, ProviderResult } from './providers';

// -- providers/authored-provider.ts ------------------------------------------
export { AuthoredProvider } from './providers/authored-provider';

// -- providers/authored-rich-markdown-provider.ts -----------------------------
export { AuthoredRichMarkdownProvider, adaptIngestedNode } from './providers/authored-rich-markdown-provider';

// -- providers/content-model-provider.ts --------------------------------------
export { ContentModelProvider } from './providers/content-model-provider';

// -- providers/files-provider.ts ----------------------------------------------
export { FilesProvider } from './providers/files-provider';

// -- providers/orgchart-provider.ts --------------------------------------------
export { OrgChartProvider } from './providers/orgchart-provider';

// -- providers/person-provider.ts -----------------------------------------------
export { PersonProvider } from './providers/person-provider';
export type { PersonProviderPR } from './providers/person-provider';

// -- providers/structural-provider.ts --------------------------------------------
export {
  StructuralProvider,
  registerStructuralTypes,
  parseCodeowners,
  buildStructuralFileNode,
} from './providers/structural-provider';

// -- providers/wikipedia-provider.ts ----------------------------------------------
export { WikipediaProvider } from './providers/wikipedia-provider';

// -- providers/work-provider.ts -----------------------------------------------------
export { WorkProvider } from './providers/work-provider';

// -- plugin-loader.ts -----------------------------------------------------------------
export { loadExternalProviders } from './plugin-loader';

// -- content-model/ ---------------------------------------------------------------------
export * from './content-model';

// -- orchestrator.ts (slice 3) ------------------------------------------------------------
export { collectProviderNodes, orchestrate, orchestrateWithTransforms } from './orchestrator';

// -- loader.ts (slice 3) -------------------------------------------------------------------
export { registerProviders, loadKnowledgeBase } from './loader';
export type { LoadKnowledgeBaseOptions } from './loader';

// -- validate-graph.ts (anokye-labs/kbexplorer-engine#18) --------------------------------------
export { validateGraph } from './validate-graph';
export type {
  GraphValidationInput,
  GraphValidationResult,
  ValidationFinding,
  ValidationRule,
  ValidationSeverity,
} from './validate-graph';

// -- assess-graph.ts (anokye-labs/kbexplorer-engine#18) ----------------------------------------
export { assessGraph } from './assess-graph';
export type {
  GraphAssessmentInput,
  AssessGraphOptions,
  AssessmentResult,
  QualityScores,
  GraphAssessmentConstraint,
  HubReachability,
  GraphAssessmentGate,
} from './assess-graph';

// -- sources/build-manifest.ts (anokye-labs/kbexplorer-engine#17) ------------------------------
// The manifest PRODUCER. Exported from the core entry (unlike `RepoSource`,
// `GitHubApiSource`, and `FileSystemSource`, which stay `./sources`-subpath-only
// because `FileSystemSource` is Node-specific) because `buildManifest` itself
// has no Node/DOM-specific imports — it only accepts an already-constructed
// `RepoSource` and reshapes its `RepoData` into a `RepoManifest`. Consumers
// still import the concrete `RepoSource` implementations from `./sources`.
export { buildManifest } from './sources/build-manifest';
export type { BuildManifestOptions } from './sources/build-manifest';

// -- catalogue/ (anokye-labs/kbexplorer-engine#19) -----------------------------------------------
// Catalogue-pipeline helpers (derive-needs / compare / enrich-from-manifest),
// ported faithfully from kbexplorer-template's derive-content.js /
// compare-content.js / enrich-context.js. Pure data in, data out — no fs
// access, no console formatting, no process.exit (that's the CLI's job).
export { deriveNeeds, compareContent, enrichFromManifest } from './catalogue';
export type {
  Catalogue,
  CatalogueNode,
  CatalogueContentFiles,
  DeriveNeedsNode,
  DeriveNeedsResult,
  ClusterChange,
  LinkCountDiff,
  CompareContentResult,
  RelatedIssue,
  RelatedPullRequest,
  RelatedCommit,
  EnrichedCatalogueNode,
  EnrichedCatalogue,
  EnrichFromManifestSummary,
  EnrichFromManifestResult,
} from './catalogue';
