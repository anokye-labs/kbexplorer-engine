/**
 * Normalized repo-data bundle (Phase 4 / F4 #318).
 *
 * The local and remote loaders historically differed only in *how* they
 * obtained raw repository data — a pre-built manifest import vs live GitHub API
 * calls — and then wired the *same* providers from it. {@link RepoData} is the
 * normalized superset both acquisition paths produce, so a single
 * `loadKnowledgeBase(source, config)` can wire providers once.
 *
 * A {@link RepoSource} is the system-of-record adapter: it both implements the
 * pure {@link Source} contract from `@anokye-labs/kbexplorer-core` (self-
 * describing, situationally-afforded {@link Resource}s) and exposes
 * {@link RepoSource.getRepoData} — the engine-facing accessor the loader
 * consumes to build the graph.
 */
import type { Source } from '@anokye-labs/kbexplorer-core';
import type { GHIssue, GHTreeItem, GHCommit, GHRelease } from '../../api';
import type { ContentModelSource } from '../content-model';

/** Pull request shape consumed by the work + person providers (superset). */
export interface RepoPullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: Array<{ name: string; color: string }>;
  html_url: string;
  created_at: string;
  updated_at: string;
  head_branch?: string;
  /** GitHub user who opened the PR (present from the API; absent from a manifest). */
  user?: { login: string };
  /** Assignees (present from the API; absent from a manifest). */
  assignees?: Array<{ login: string }>;
}

/** Repository metadata consumed by the work provider. */
export interface RepoMetadata {
  name: string;
  description: string;
  html_url: string;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  private: boolean;
  topics: string[];
  primary_language: string;
  languages: Array<{ name: string; size: number }>;
  owner: { login: string; avatar_url: string };
}

/**
 * The normalized raw-data bundle a {@link RepoSource} hands the loader. Optional
 * fields degrade gracefully: a source that cannot supply them (e.g. the API
 * source has no `nodemapRaw` yet) leaves them empty/null and the matching
 * provider becomes a safe no-op — keeping output byte-identical per source.
 */
export interface RepoData {
  /** owner/name slug for file-node identity. */
  repo: string;
  tree: GHTreeItem[];
  authoredContent: Record<string, string>;
  nodemapRaw: string | null;
  nodemapFiles?: Record<string, string>;
  nodemapDirs?: Record<string, GHTreeItem[]>;
  /** Glob lookup over authored/nodemap files (empty for sources without one). */
  listFiles: (pattern: string) => Promise<string[]>;
  issues: GHIssue[];
  pullRequests: RepoPullRequest[];
  commits: GHCommit[];
  branches: Array<{ name: string; protected: boolean }>;
  repoMetadata: RepoMetadata | null;
  releases: GHRelease[];
  structuralFiles: Record<string, string>;
  structuredNodeMapRaw: string | null;
  contentModel: ContentModelSource | null;
  readme: string | null;
  themeFileRaw?: string | null;
}

/**
 * A system-of-record adapter. Implements the pure {@link Source} contract (the
 * navigable, situationally-afforded resource surface) and exposes the
 * engine-facing {@link getRepoData} the loader consumes.
 */
export interface RepoSource extends Source {
  /** Produce the normalized data bundle the provider pipeline consumes. */
  getRepoData(): Promise<RepoData>;
}
