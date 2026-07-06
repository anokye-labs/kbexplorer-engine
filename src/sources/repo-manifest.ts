/**
 * RepoManifest — the pre-built snapshot shape a {@link ManifestSource} is
 * constructed from (relocated from kbexplorer-template's `src/engine/
 * local-loader.ts` in anokye-labs/kbexplorer-template#472, slice 4/5).
 *
 * It moves into this package because `ManifestSource`'s constructor takes one.
 * The manifest-generation script and the local (manifest-import) loader remain
 * template-side; only the interface travels here.
 */
import type { GHIssue, GHRelease } from '../github-types';
import type { ContentModelSource } from '../content-model';

export interface RepoManifest {
  configRaw: string | null;
  authoredContent: Record<string, string>;
  tree: Array<{ path: string; type: 'blob' | 'tree'; size?: number }>;
  readme: string | null;
  issues: GHIssue[];
  pullRequests: Array<{
    number: number;
    title: string;
    body: string;
    state: string;
    labels: Array<{ name: string; color: string }>;
    html_url: string;
    created_at: string;
    updated_at: string;
    head_branch?: string;
  }>;
  commits: Array<{
    sha: string;
    commit: { message: string; author: { name: string; date: string } };
    html_url: string;
  }>;
  branches?: Array<{ name: string; protected: boolean }>;
  /**
   * GitHub releases (non-draft, newest-first, capped at 30). Absent/empty in
   * repos without releases — the WorkProvider handles this gracefully (safe no-op).
   */
  releases?: GHRelease[];
  repoMetadata?: {
    name: string;
    description: string;
    html_url: string;
    /** Repo homepage URL (blank when unset). Matches the old generator's 12-key `fetchRepoMetadata` shape. */
    homepage: string;
    default_branch: string;
    stargazers_count: number;
    forks_count: number;
    private: boolean;
    topics: string[];
    primary_language: string;
    languages: Array<{ name: string; size: number }>;
    owner: { login: string; avatar_url: string };
  } | null;
  nodemapRaw?: string | null;
  nodemapFiles?: Record<string, string>;
  nodemapDirs?: Record<string, Array<{ path: string; type: 'blob' | 'tree'; size?: number }>>;
  structuredNodeMapRaw?: string | null;
  structuralFiles?: Record<string, string>;
  /**
   * Optional content-model source (F2): schema files + entity files keyed by
   * path relative to `structuredContent.path` (default `content-model/`). Absent
   * (null) in repos without a content model — the ContentModelProvider is then a
   * safe no-op.
   */
  contentModel?: ContentModelSource | null;
  /**
   * Optional raw contents of the dedicated theme file referenced by
   * `config.theme.themesFile` (F5/T5.1). Read at manifest-generation time from
   * the host repo and merged into the theme block in local mode the same way
   * the remote loader fetches it at runtime. Null/absent when no themesFile is
   * configured or the file is missing — a safe no-op.
   */
  themeFileRaw?: string | null;
  generatedAt: string;
}
