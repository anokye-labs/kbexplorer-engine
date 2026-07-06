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
import type { RepoMetadata } from './sources/repo-data';

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
  'branches',
  'languages',
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
  const token = (env?.GITHUB_TOKEN ?? env?.GH_TOKEN) as string | undefined;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
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

export interface CacheStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
}

// ── Public API ─────────────────────────────────────────────

/** Fetch and decode a single file from the repo. */
export async function fetchFile(source: SourceConfig, path: string, env?: EngineEnv, cache?: CacheStore): Promise<string> {
  const branch = source.branch ?? 'main';
  const key = `file:${source.owner}/${source.repo}:${path}`;
  const hit = cache?.get<string>(key);
  if (hit !== undefined) return hit;

  const { data } = await ghFetch<GHFileContent>(
    `/repos/${source.owner}/${source.repo}/contents/${path}?ref=${branch}`,
    env,
  );

  const binary = atob(data.content);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const decoded = new TextDecoder().decode(bytes);
  cache?.set(key, decoded);
  return decoded;
}

/** List all files in a directory (recursive via Git Trees API). */
export async function fetchTree(source: SourceConfig, path?: string, env?: EngineEnv, cache?: CacheStore): Promise<GHTreeItem[]> {
  const branch = source.branch ?? 'main';
  const key = `tree:${source.owner}/${source.repo}:${path ?? ''}`;
  const hit = cache?.get<GHTreeItem[]>(key);
  if (hit !== undefined) return hit;

  const { data } = await ghFetch<{ tree: GHTreeItem[] }>(
    `/repos/${source.owner}/${source.repo}/git/trees/${branch}?recursive=1`,
    env,
  );

  const items = path
    ? data.tree.filter(item => item.path.startsWith(path + '/'))
    : data.tree;
  cache?.set(key, items);
  return items;
}

/** Fetch issues (not PRs) from the repo. */
export async function fetchIssues(source: SourceConfig, env?: EngineEnv, cache?: CacheStore): Promise<GHIssue[]> {
  const key = `issues:${source.owner}/${source.repo}`;
  const hit = cache?.get<GHIssue[]>(key);
  if (hit !== undefined) return hit;

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

  cache?.set(key, allIssues);
  return allIssues;
}

/** Fetch pull requests from the repo. */
export async function fetchPullRequests(source: SourceConfig, env?: EngineEnv, cache?: CacheStore): Promise<GHIssue[]> {
  const key = `prs:${source.owner}/${source.repo}`;
  const hit = cache?.get<GHIssue[]>(key);
  if (hit !== undefined) return hit;

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

  cache?.set(key, allPRs);
  return allPRs;
}

/** Fetch recent commits from the repo. */
export async function fetchCommits(source: SourceConfig, count = 30, env?: EngineEnv, cache?: CacheStore): Promise<GHCommit[]> {
  const key = `commits:${source.owner}/${source.repo}`;
  const hit = cache?.get<GHCommit[]>(key);
  if (hit !== undefined) return hit;

  const branch = source.branch ?? 'main';
  const { data } = await ghFetch<GHCommit[]>(
    `/repos/${source.owner}/${source.repo}/commits?sha=${branch}&per_page=${count}`,
    env,
  );

  cache?.set(key, data);
  return data;
}

/** Fetch GitHub releases (non-draft, newest-first, capped at 30). */
export async function fetchReleases(source: SourceConfig, limit = 30, env?: EngineEnv, cache?: CacheStore): Promise<GHRelease[]> {
  const key = `releases:${source.owner}/${source.repo}`;
  const hit = cache?.get<GHRelease[]>(key);
  if (hit !== undefined) return hit;

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

  cache?.set(key, releases);
  return releases;
}

/** Fetch multiple files in parallel. */
export async function fetchFiles(
  source: SourceConfig,
  paths: string[],
  env?: EngineEnv,
  cache?: CacheStore,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const settled = await Promise.allSettled(
    paths.map(async path => {
      const content = await fetchFile(source, path, env, cache);
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

/** A single branch as returned by the Branches API, shaped `{name, protected}`. */
export interface GHBranchInfo {
  name: string;
  protected: boolean;
}

/** Minimal fields this client reads off the single-repo (`GET /repos/{owner}/{repo}`) response. */
interface GHRepoResponse {
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  private: boolean;
  topics?: string[];
  language: string | null;
  owner: { login: string; avatar_url: string };
}

/** Fetch all branches, shaped `{name, protected}` — mirrors the old generator's `fetchLocalBranches`. */
export async function fetchBranches(source: SourceConfig, env?: EngineEnv, cache?: CacheStore): Promise<GHBranchInfo[]> {
  const key = `branches:${source.owner}/${source.repo}`;
  const hit = cache?.get<GHBranchInfo[]>(key);
  if (hit !== undefined) return hit;

  const all: GHBranchInfo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await ghFetch<Array<{ name: string; protected?: boolean }>>(
      `/repos/${source.owner}/${source.repo}/branches?per_page=${perPage}&page=${page}`,
      env,
    );
    all.push(...data.map(b => ({ name: b.name, protected: b.protected ?? false })));
    if (data.length < perPage) break;
    page++;
  }

  cache?.set(key, all);
  return all;
}

/**
 * Fetch repo metadata + language breakdown, shaped to the old generator's
 * 12-key `fetchRepoMetadata` (`gh repo view --json ...`). REST equivalent:
 * `GET /repos/{owner}/{repo}` for most fields, plus `GET .../languages` for
 * the byte-size-per-language breakdown (sorted largest-first, matching the
 * GraphQL `languages` connection's default `SIZE DESC` ordering).
 */
export async function fetchRepoMetadata(source: SourceConfig, env?: EngineEnv, cache?: CacheStore): Promise<RepoMetadata> {
  const key = `repoMetadata:${source.owner}/${source.repo}`;
  const hit = cache?.get<RepoMetadata>(key);
  if (hit !== undefined) return hit;

  const [{ data: repo }, languagesMap] = await Promise.all([
    ghFetch<GHRepoResponse>(`/repos/${source.owner}/${source.repo}`, env),
    ghFetch<Record<string, number>>(`/repos/${source.owner}/${source.repo}/languages`, env)
      .then(r => r.data)
      .catch(() => ({}) as Record<string, number>),
  ]);

  const languages = Object.entries(languagesMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, size]) => ({ name, size }));

  const metadata: RepoMetadata = {
    name: repo.name ?? '',
    description: repo.description ?? '',
    html_url: repo.html_url ?? '',
    homepage: repo.homepage ?? '',
    default_branch: repo.default_branch ?? 'main',
    stargazers_count: repo.stargazers_count ?? 0,
    forks_count: repo.forks_count ?? 0,
    private: repo.private ?? false,
    topics: repo.topics ?? [],
    primary_language: repo.language ?? '',
    languages,
    owner: {
      login: repo.owner?.login ?? '',
      avatar_url: repo.owner?.avatar_url ?? '',
    },
  };

  cache?.set(key, metadata);
  return metadata;
}
