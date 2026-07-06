/**
 * Slice 4/5 (anokye-labs/kbexplorer-template#472) — GitHub client fetch/parse +
 * error-handling tests, ported from template's `src/api/__tests__/github.test.ts`.
 *
 * Adapted for this package's cache-free, runtime-agnostic client: no browser
 * storage mock (the port has no cache), no build-time env stub (the API base is
 * a per-call parameter defaulting to api.github.com), and self-contained inline
 * fixtures instead of the template's DTU fixture files. Only `fetch` is stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as github from '../github-client';

// ── Inline fixtures (minimal equivalents of the template DTU fixtures) ─────
const treeFixture = {
  tree: [
    { path: 'README.md', mode: '100644', type: 'blob', sha: 'a1', size: 10, url: '' },
    { path: 'src', mode: '040000', type: 'tree', sha: 'b2', url: '' },
    { path: 'src/index.ts', mode: '100644', type: 'blob', sha: 'c3', size: 20, url: '' },
    { path: 'src/util.ts', mode: '100644', type: 'blob', sha: 'd4', size: 30, url: '' },
  ],
};

const issuesFixture = [
  { number: 1, title: 'Issue one', body: 'a', state: 'open', labels: [], assignees: [], html_url: '', created_at: '', updated_at: '' },
  { number: 2, title: 'Issue two', body: 'b', state: 'closed', labels: [], assignees: [], html_url: '', created_at: '', updated_at: '' },
  { number: 3, title: 'A PR masquerading as issue', body: 'c', state: 'open', labels: [], assignees: [], html_url: '', created_at: '', updated_at: '', pull_request: { url: 'x' } },
];

const pullsFixture = [
  { number: 10, title: 'PR ten', body: 'p', state: 'open', labels: [], assignees: [], html_url: '', created_at: '', updated_at: '' },
  { number: 11, title: 'PR eleven', body: 'q', state: 'merged', labels: [], assignees: [], html_url: '', created_at: '', updated_at: '' },
];

const commitsFixture = [
  { sha: 'sha1', commit: { message: 'first', author: { name: 'a', date: '' } }, html_url: '' },
  { sha: 'sha2', commit: { message: 'second', author: { name: 'b', date: '' } }, html_url: '' },
];

const readmeText = '# kbexplorer\n\nInteractive Knowledge Base Explorer\n';
const readmeFixture = {
  name: 'README.md',
  path: 'README.md',
  sha: 'r1',
  content: Buffer.from(readmeText, 'utf8').toString('base64'),
  encoding: 'base64',
};

class MemoryCacheStore {
  private readonly store = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, value);
  }
}

// ── Mock fetch ────────────────────────────────────────────
function mockFetchSuccess(body: unknown, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Map(Object.entries(headers)),
  });
}

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Route fetch calls to the right fixture based on URL path
function setupFetchRouter() {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/git/trees/')) return mockFetchSuccess(treeFixture);
    if (url.includes('/issues?')) return mockFetchSuccess(issuesFixture);
    if (url.includes('/pulls?')) return mockFetchSuccess(pullsFixture);
    if (url.includes('/commits?')) return mockFetchSuccess(commitsFixture);
    if (url.includes('/contents/')) return mockFetchSuccess(readmeFixture);
    return mockFetchSuccess([]);
  });
}

// ── Source config used across tests ───────────────────────
const source = { owner: 'anokye-labs', repo: 'kbexplorer-template', branch: 'main' };

beforeEach(() => {
  fetchMock.mockReset();
  setupFetchRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────

describe('fetchTree', () => {
  it('returns all tree items from fixture', async () => {
    const items = await github.fetchTree(source);
    expect(items).toHaveLength(treeFixture.tree.length);
    expect(items[0]).toHaveProperty('path');
    expect(items[0]).toHaveProperty('type');
  });

  it('filters by path prefix when path is provided', async () => {
    const items = await github.fetchTree(source, 'src');
    const expected = treeFixture.tree.filter(
      (i: { path: string }) => i.path.startsWith('src/')
    );
    expect(items).toHaveLength(expected.length);
    expect(items.every((i: { path: string }) => i.path.startsWith('src/'))).toBe(true);
  });
});

describe('fetchIssues', () => {
  it('returns issues excluding PRs (items with pull_request field)', async () => {
    const issues = await github.fetchIssues(source);
    const expectedCount = issuesFixture.filter(
      (i: { pull_request?: unknown }) => !i.pull_request
    ).length;
    expect(issues).toHaveLength(expectedCount);
    // None should have pull_request field
    for (const issue of issues) {
      expect(issue).not.toHaveProperty('pull_request');
    }
  });

  it('paginates — a short page stops pagination after one fetch', async () => {
    let callCount = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/issues?')) {
        callCount++;
        // Fixture has < 100 items → pagination stops after one fetch.
        return mockFetchSuccess(issuesFixture);
      }
      return mockFetchSuccess([]);
    });

    await github.fetchIssues(source);
    expect(callCount).toBe(1);
  });
});

describe('fetchPullRequests', () => {
  it('returns PRs from fixture', async () => {
    const prs = await github.fetchPullRequests(source);
    expect(prs).toHaveLength(pullsFixture.length);
    expect(prs[0]).toHaveProperty('number');
    expect(prs[0]).toHaveProperty('title');
  });
});

describe('fetchCommits', () => {
  it('returns commits from fixture', async () => {
    const commits = await github.fetchCommits(source);
    expect(commits).toHaveLength(commitsFixture.length);
    expect(commits[0]).toHaveProperty('sha');
    expect(commits[0]).toHaveProperty('commit');
    expect(commits[0]!.commit).toHaveProperty('message');
  });
});

describe('fetchFile', () => {
  it('decodes base64 content from fixture', async () => {
    const content = await github.fetchFile(source, 'README.md');
    expect(content).toContain('# kbexplorer');
    expect(content).toContain('Interactive Knowledge Base Explorer');
  });
});

describe('cache seam', () => {
  it('uses cache for repeated file fetches when a cache is provided', async () => {
    const cache = new MemoryCacheStore();

    const first = await github.fetchFile(source, 'README.md', undefined, cache);
    const second = await github.fetchFile(source, 'README.md', undefined, cache);

    expect(first).toContain('# kbexplorer');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses cache for repeated issue fetches when a cache is provided', async () => {
    const cache = new MemoryCacheStore();

    const first = await github.fetchIssues(source, undefined, cache);
    const second = await github.fetchIssues(source, undefined, cache);

    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache by default when no cache is passed', async () => {
    await github.fetchFile(source, 'README.md');
    await github.fetchFile(source, 'README.md');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchFiles', () => {
  it('fetches multiple files in parallel', async () => {
    const results = await github.fetchFiles(source, ['README.md', 'docs/guide.md']);
    // README.md should succeed
    expect(results.has('README.md')).toBe(true);
    expect(results.get('README.md')).toContain('# kbexplorer');
    // Both paths hit the same fixture (mock routes /contents/ → readme fixture)
    expect(results.size).toBe(2);
  });
});

describe('endpoint patterns', () => {
  it('exports one canonical entry per ghFetch endpoint family', () => {
    expect(github.GITHUB_ENDPOINT_PATTERNS).toEqual([
      'contents/', 'git/trees/', 'issues', 'pulls', 'commits', 'releases', 'branches', 'languages',
    ]);
  });
});

describe('error handling', () => {
  it('throws RateLimitError on 403 with X-RateLimit-Remaining: 0', async () => {
    const resetTime = Math.floor(Date.now() / 1000) + 3600;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ message: 'rate limit exceeded' }),
      text: () => Promise.resolve('rate limit exceeded'),
      headers: new Map([
        ['X-RateLimit-Remaining', '0'],
        ['X-RateLimit-Reset', String(resetTime)],
      ]),
    });

    await expect(github.fetchTree(source)).rejects.toThrow(github.RateLimitError);
  });

  it('throws NotModifiedError on 304 response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 304,
      json: () => Promise.resolve(null),
      text: () => Promise.resolve(''),
      headers: new Map(),
    });

    await expect(github.fetchTree(source)).rejects.toThrow(github.NotModifiedError);
  });
});
