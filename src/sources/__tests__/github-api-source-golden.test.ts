/**
 * GitHubApiSource parity test (anokye-labs/kbexplorer-engine#23): proves the
 * remote acquisition path reaches the same field-completeness as
 * `FileSystemSource` (see `build-manifest-golden.test.ts`) for the fields the
 * old `scripts/generate-manifest.js` used to emit — `nodemapRaw`/
 * `nodemapFiles`/`nodemapDirs`, `themeFileRaw`, `branches`, `repoMetadata` —
 * plus the commits-fetch-limit bump (30 -> 50).
 *
 * Unlike the local golden test (a committed fixture directory + a captured
 * snapshot from the real template script), there is no live GitHub API to
 * record against for CI. Instead this stubs `fetch` with an inline, in-memory
 * GitHub API fixture (same style as `github-client.test.ts`) representing a
 * small repo whose shape mirrors `fixtures/manifest-repo`: a `nodemap.yaml`
 * with `file`/`glob`+`each:file`/`directory` entries, a `config.yaml` with a
 * `theme.themesFile`, branches, and repo metadata — then asserts
 * `buildManifest()` over a `GitHubApiSource` populates every new field with
 * the expected shape, and that the commits request is capped at 50.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubApiSource } from '../github-api-source';
import { buildManifest } from '../build-manifest';

const source = { owner: 'acme', repo: 'gh-manifest-repo', branch: 'main', path: 'content' };

// ── Inline GitHub-API fixture (mirrors fixtures/manifest-repo's shape) ────
const treeFixture = {
  tree: [
    { path: '.github', type: 'tree' },
    { path: '.github/CODEOWNERS', type: 'blob', size: 11 },
    { path: 'content', type: 'tree' },
    { path: 'content/config.yaml', type: 'blob', size: 74 },
    { path: 'content/alpha.md', type: 'blob', size: 66 },
    { path: 'content/beta.md', type: 'blob', size: 62 },
    { path: 'content/themes', type: 'tree' },
    { path: 'content/themes/extra.yaml', type: 'blob', size: 82 },
    { path: 'content-model', type: 'tree' },
    { path: 'content-model/entities', type: 'tree' },
    { path: 'content-model/entities/thing.yaml', type: 'blob', size: 25 },
    { path: 'content-model/schema.yaml', type: 'blob', size: 24 },
    { path: 'nodemap.yaml', type: 'blob', size: 165 },
    { path: 'README.md', type: 'blob', size: 23 },
  ],
};

const fileContents: Record<string, string> = {
  'content/config.yaml': 'clusters:\n  core:\n    name: Core\n    color: \'#000000\'\ntheme:\n  themesFile: content/themes/extra.yaml\n',
  'content/alpha.md': '---\nid: alpha\ntitle: Alpha\ncluster: core\n---\n# Alpha\n\nBody alpha.\n',
  'content/beta.md': '---\nid: beta\ntitle: Beta\ncluster: core\n---\n# Beta\n\nBody beta.\n',
  'content/themes/extra.yaml': 'themes:\n  midnight:\n    displayName: Midnight\n    brand:\n      primary: \'#101020\'\n',
  'content-model/entities/thing.yaml': 'kind: entity\nid: thing-1\n',
  'content-model/schema.yaml': 'kind: schema\nname: demo\n',
  'nodemap.yaml': 'nodes:\n  - id: alpha\n    file: content/alpha.md\n  - id: content-files\n    glob: "content/*.md"\n    each: file\n  - id: content-model-dir\n    directory: content-model\n',
  'README.md': '# Fixture Repo\n\nHello.\n',
  '.github/CODEOWNERS': '* @octocat\n',
};

const branchesFixture = [{ name: 'main', protected: true }];

const repoFixture = {
  name: 'gh-manifest-repo',
  description: 'A demo repo',
  html_url: 'https://github.com/acme/gh-manifest-repo',
  homepage: 'https://acme.example',
  default_branch: 'main',
  stargazers_count: 42,
  forks_count: 3,
  private: false,
  topics: ['kb', 'demo'],
  language: 'TypeScript',
  owner: { login: 'acme', avatar_url: 'https://x/acme.png' },
};

const languagesFixture = { TypeScript: 200, YAML: 80 };

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function mockFetchSuccess(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Map<string, string>(),
  });
}

function mockFetchNotFound() {
  return Promise.resolve({
    ok: false,
    status: 404,
    json: () => Promise.resolve({ message: 'Not Found' }),
    text: () => Promise.resolve('Not Found'),
    headers: new Map<string, string>(),
  });
}

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
const requestedUrls: string[] = [];

beforeEach(() => {
  requestedUrls.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    requestedUrls.push(url);

    if (url.includes('/git/trees/')) return mockFetchSuccess(treeFixture);
    if (url.includes('/languages')) return mockFetchSuccess(languagesFixture);
    if (url.includes('/branches')) return mockFetchSuccess(branchesFixture);
    if (url.includes('/issues?')) return mockFetchSuccess([]);
    if (url.includes('/pulls?')) return mockFetchSuccess([]);
    if (url.includes('/commits?')) return mockFetchSuccess([]);
    if (url.includes('/releases?')) return mockFetchSuccess([]);
    if (url.includes('/contents/')) {
      const match = /\/contents\/(.+?)\?/.exec(url);
      const path = match?.[1] ? decodeURIComponent(match[1]) : '';
      const content = fileContents[path];
      if (content === undefined) return mockFetchNotFound();
      return mockFetchSuccess({ name: path, path, sha: 'x', content: base64(content), encoding: 'base64' });
    }
    // Bare `/repos/{owner}/{repo}` (repo metadata) — must be checked last since
    // every other pattern above is also a suffix of a `/repos/...` URL.
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) return mockFetchSuccess(repoFixture);
    return mockFetchSuccess([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GitHubApiSource — parity with FileSystemSource for engine#23 fields', () => {
  it('populates nodemapRaw/nodemapFiles/nodemapDirs/themeFileRaw/branches/repoMetadata', async () => {
    const apiSource = new GitHubApiSource(source, 'full');
    const manifest = await buildManifest(apiSource, { generatedAt: '2024-01-01T00:00:00.000Z' });

    expect(manifest.nodemapRaw).toBe(fileContents['nodemap.yaml']);
    expect(manifest.nodemapFiles).toEqual({
      'content/alpha.md': fileContents['content/alpha.md'],
      'content/beta.md': fileContents['content/beta.md'],
    });
    expect(manifest.nodemapDirs).toEqual({
      'content-model': [
        { path: 'content-model/entities', type: 'tree' },
        { path: 'content-model/schema.yaml', type: 'blob', size: 24 },
      ],
    });
    expect(manifest.themeFileRaw).toBe(fileContents['content/themes/extra.yaml']);

    expect(manifest.branches).toEqual(branchesFixture);
    expect(manifest.repoMetadata).toEqual({
      name: 'gh-manifest-repo',
      description: 'A demo repo',
      html_url: 'https://github.com/acme/gh-manifest-repo',
      homepage: 'https://acme.example',
      default_branch: 'main',
      stargazers_count: 42,
      forks_count: 3,
      private: false,
      topics: ['kb', 'demo'],
      primary_language: 'TypeScript',
      languages: [{ name: 'TypeScript', size: 200 }, { name: 'YAML', size: 80 }],
      owner: { login: 'acme', avatar_url: 'https://x/acme.png' },
    });
  });

  it('requests commits capped at 50 (bumped from the old 30)', async () => {
    const apiSource = new GitHubApiSource(source, 'full');
    await apiSource.getRepoData();

    const commitsUrl = requestedUrls.find(u => u.includes('/commits?'));
    expect(commitsUrl).toBeDefined();
    expect(commitsUrl).toContain('per_page=50');
    expect(commitsUrl).not.toContain('per_page=30');
  });
});
