/**
 * GitHub API client for fetching repository content at runtime.
 *
 * Runtime-agnostic, boundary-pure port of kbexplorer-template's
 * `src/api/github.ts` (anokye-labs/kbexplorer-template#472, slice 4/5). The
 * template client wrapped every call in a browser-storage cache and read the
 * API base from a Vite build-time env at module scope. Neither of those belongs
 * in this runtime-agnostic engine package, so this port drops the cache layer
 * entirely (it stays template-side as a thin wrapper) and injects the API base
 * per call via an optional {@link EngineEnv} argument — mirroring the injection
 * idiom already used in `src/store/config.ts`. `resolveImageUrl` (a pure
 * UI/dev-server concern) is intentionally not ported; it stays in template.
 *
 * Supports two modes:
 *   - authored: fetches markdown files from a content directory
 *   - repo-aware: fetches issues, PRs, README, and file tree
 */
import type { SourceConfig } from '@anokye-labs/kbexplorer-core';
import type { EngineEnv } from './env';
import type { GHIssue, GHTreeItem, GHCommit, GHRelease } from './github-types';

/**
 * The distinct GitHub REST endpoint path patterns this client's `ghFetch` call
 * sites hit — one entry per endpoint family. Exported as a single source of
 * truth so an out-of-repo drift-detection test (kbexplorer-template's
 * `twin-coverage.test.ts`) can import it instead of regexing this file's raw
 * source text: adding a new endpoint here fails that test until a matching twin
 * route exists. Keep this in sync with the paths passed to `ghFetch` below.
 */
export const GITHUB_ENDPOINT_PATTERNS = [
  'contents/',
  'git/trees/',
  'issues',
  'pulls',
  'commits',
  'releases',
] as const;

const DEFAULT_GH_API_BASE = 'https://api.github.com';

/** Resolve the GitHub API base for a call, defaulting to the public API. */
function resolveApiBase(env?: EngineEnv): string {
  return (env?.VITE_GH_API_BASE as string | undefined) ?? DEFAULT_GH_API_BASE;
}

async function ghFetch<T>(
  path: string,
  env?: EngineEnv,
  etag?: string,
): Promise<{ data: T; etag?: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (etag) {
    headers['If-None-Match'] = etag;
  }

  const res = await fetch(`${resolveApiBase(env)}${path}`, { headers });

  if (res.status === 304) {
    throw new NotModifiedError();
  }
  if (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0') {
    const reset = res.headers.get('X-RateLimit-Reset');
    throw new RateLimitError(reset ? new Date(Number(reset) * 1000) : undefined);
  }
  if (!res.ok) {
    throw new GitHubApiError(res.status, await res.text());
  }

  const data = (await res.json()) as T;
  const responseEtag = res.headers.get('ETag');
  return responseEtag ? { data, etag: responseEtag } : { data };
}

export class NotModifiedError extends Error {
  constructor() { super('Not modified'); this.name = 'NotModifiedError'; }
}

export class RateLimitError extends Error {
  resetAt?: Date;
  constructor(resetAt?: Date) {
    super(`GitHub API rate limit exceeded${resetAt ? `. Resets at ${resetAt.toISOString()}` : ''}`);
    this.name = 'RateLimitError';
    if (resetAt) this.resetAt = resetAt;
  }
}

export class GitHubApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`GitHub API error ${status}: ${body}`);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

// ── GitHub API response types ──────────────────────────────

export interface GHFileContent {
  name: string;
  path: string;
  sha: string;
  content: string; // base64 encoded
  encoding: string;
}

// ── Public API ─────────────────────────────────────────────

/** Fetch and decode a single file from the repo. */
export async function fetchFile(source: SourceConfig, path: string, env?: EngineEnv): Promise<string> {
  const branch = source.branch ?? 'main';
  const { data } = await ghFetch<GHFileContent>(
    `/repos/${source.owner}/${source.repo}/contents/${path}?ref=${branch}`,
    env,
  );

  const binary = atob(data.content);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** List all files in a directory (recursive via Git Trees API). */
export async function fetchTree(source: SourceConfig, path?: string, env?: EngineEnv): Promise<GHTreeItem[]> {
  const branch = source.branch ?? 'main';
  const { data } = await ghFetch<{ tree: GHTreeItem[] }>(
    `/repos/${source.owner}/${source.repo}/git/trees/${branch}?recursive=1`,
    env,
  );

  return path
    ? data.tree.filter(item => item.path.startsWith(path + '/'))
    : data.tree;
}

/** Fetch issues (not PRs) from the repo. */
export async function fetchIssues(source: SourceConfig, env?: EngineEnv): Promise<GHIssue[]> {
  const allIssues: GHIssue[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await ghFetch<GHIssue[]>(
      `/repos/${source.owner}/${source.repo}/issues?state=all&per_page=${perPage}&page=${page}`,
      env,
    );
    // Filter out PRs (GitHub API includes PRs in issues endpoint)
    const issues = data.filter(i => !i.pull_request);
    allIssues.push(...issues);
    if (data.length < perPage) break;
    page++;
  }

  return allIssues;
}

/** Fetch pull requests from the repo. */
export async function fetchPullRequests(source: SourceConfig, env?: EngineEnv): Promise<GHIssue[]> {
  const allPRs: GHIssue[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await ghFetch<GHIssue[]>(
      `/repos/${source.owner}/${source.repo}/pulls?state=all&per_page=${perPage}&page=${page}`,
      env,
    );
    allPRs.push(...data);
    if (data.length < perPage) break;
    page++;
  }

  return allPRs;
}

/** Fetch recent commits from the repo. */
export async function fetchCommits(source: SourceConfig, count = 30, env?: EngineEnv): Promise<GHCommit[]> {
  const branch = source.branch ?? 'main';
  const { data } = await ghFetch<GHCommit[]>(
    `/repos/${source.owner}/${source.repo}/commits?sha=${branch}&per_page=${count}`,
    env,
  );

  return data;
}

/** Fetch GitHub releases (non-draft, newest-first, capped at 30). */
export async function fetchReleases(source: SourceConfig, limit = 30, env?: EngineEnv): Promise<GHRelease[]> {
  const { data } = await ghFetch<Array<{
    tag_name: string;
    name: string | null;
    body: string | null;
    html_url: string;
    published_at: string | null;
    prerelease: boolean;
    draft: boolean;
  }>>(`/repos/${source.owner}/${source.repo}/releases?per_page=${limit}`, env);

  const releases: GHRelease[] = data
    .filter(r => !r.draft)
    .sort((a, b) => new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime())
    .slice(0, limit)
    .map(r => ({
      tag_name: r.tag_name ?? '',
      name: r.name ?? r.tag_name ?? '',
      body: r.body ?? '',
      html_url: r.html_url ?? '',
      published_at: r.published_at ?? '',
      prerelease: r.prerelease ?? false,
    }));

  return releases;
}

/** Fetch multiple files in parallel. */
export async function fetchFiles(
  source: SourceConfig,
  paths: string[],
  env?: EngineEnv,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const settled = await Promise.allSettled(
    paths.map(async path => {
      const content = await fetchFile(source, path, env);
      return { path, content };
    })
  );
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.set(result.value.path, result.value.content);
    }
  }
  return results;
}
