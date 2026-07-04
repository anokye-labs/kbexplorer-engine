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

// -- parser.ts ----------------------------------------------------------------
// NOTE: loadAuthoredContent / loadRepoContent / loadConfig are withheld —
// they call the live GitHub client, which lands in slice 4.
export {
  parseMarkdownFile,
  issueToNode,
  treeToNodes,
  extractIssueRefs,
  splitIntoSections,
  extractClusters,
} from './parser';
export type { IssueToNodeOptions } from './parser';

// -- github-types.ts ----------------------------------------------------------
export type { GHIssue, GHTreeItem, GHRelease, GHCommit } from './github-types';

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
