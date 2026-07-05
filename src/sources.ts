/**
 * Public `./sources` subpath — slices 3-4/5 of the kbexplorer-template ->
 * kbexplorer-engine migration (anokye-labs/kbexplorer-template#472, epic #463).
 *
 * Slice 3 landed the `RepoSource`/`RepoData`/`RepoPullRequest`/`RepoMetadata`
 * types. Slice 4 replaces the former placeholder `ManifestSource` /
 * `GitHubApiSource` classes with their real implementations, relocates the
 * `RepoManifest` snapshot shape into this package, and surfaces the
 * GitHub-source-specific errors + the canonical endpoint-pattern list on this
 * subpath.
 */
export { ManifestSource } from './sources/manifest-source';
export { GitHubApiSource } from './sources/github-api-source';
export type { ResolutionPreset } from './sources/github-api-source';

export type { RepoManifest } from './sources/repo-manifest';

export {
  GITHUB_ENDPOINT_PATTERNS,
  NotModifiedError,
  RateLimitError,
  GitHubApiError,
} from './github-client';

export type { CacheStore, GHFileContent } from './github-client';

export {
  fetchFile,
  fetchTree,
  fetchIssues,
  fetchPullRequests,
  fetchCommits,
  fetchReleases,
  fetchFiles,
} from './github-client';

export type { GHIssue, GHTreeItem, GHCommit, GHRelease } from './github-types';

export type {
  RepoSource,
  RepoData,
  RepoPullRequest,
  RepoMetadata,
} from './sources/repo-data';
