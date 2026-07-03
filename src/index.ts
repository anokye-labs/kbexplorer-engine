/**
 * Public API — slice 1/5 of the kbexplorer-template → kbexplorer-engine
 * migration (anokye-labs/kbexplorer-template#472, epic #463).
 *
 * This mirrors the shape of template's `src/engine/index.ts` barrel, limited
 * to the symbols originating from the modules that have moved so far
 * (parser/identity pipeline core + node-types). `loadAuthoredContent`,
 * `loadRepoContent`, and `loadConfig` are intentionally NOT exported here:
 * their bodies were removed from `./parser` in this slice because they
 * depend on the live GitHub client, which doesn't move until slice 4.
 * Providers, the orchestrator, sources, and the store are out of scope for
 * this slice and are not exported here either.
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
export type { GHIssue, GHTreeItem } from './github-types';

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
