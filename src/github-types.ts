/**
 * Minimal GitHub API shapes needed by `parser.ts`'s `issueToNode` /
 * `treeToNodes`. These are NOT the full GitHub REST client types — just the
 * fields those two functions actually read. The full client (`fetchFile`,
 * `fetchTree`, `fetchFiles`, `fetchIssues`) lives in kbexplorer-template's
 * `src/api/github.ts`, which has not moved to this package yet (slice 4).
 */

/** A GitHub issue or pull request, as returned by the Issues API. */
export interface GHIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  labels: Array<{ name: string; color?: string }>;
  assignees?: Array<{ login: string }> | null;
  /** The GitHub user who opened the issue/PR (author). Added in slice 2 for PersonProvider/WorkProvider's author-attribution logic — absent from slice 1's parser-only subset. */
  user?: { login: string };
  /** Present (and truthy) only when the issue is actually a pull request. */
  pull_request?: unknown;
}

/** A single entry in a GitHub repo's git tree, as returned by the Git Trees API. */
export interface GHTreeItem {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
  /** Git file mode (e.g. `'100644'`, `'040000'`). Not read by `treeToNodes` itself. */
  mode?: string;
  /** Blob/tree SHA. Not read by `treeToNodes` itself. */
  sha?: string;
  /** API URL for this tree entry. Not read by `treeToNodes` itself. */
  url?: string;
}

/**
 * A GitHub release as returned by the releases API.
 * Drafts are excluded; prerelease flag is preserved.
 */
export interface GHRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  prerelease: boolean;
}

/**
 * A single commit as returned by the Commits API. Added in slice 3 for
 * `sources/repo-data.ts`'s `RepoData.commits` field (consumed by `WorkProvider`).
 */
export interface GHCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  html_url: string;
  files?: Array<{ filename: string; status: string }>;
}
