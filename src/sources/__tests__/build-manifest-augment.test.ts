import { describe, expect, it } from 'vitest';
import { buildManifest } from '../build-manifest';
import type { RepoData, RepoSource } from '../repo-data';

function makeSource(data: RepoData): RepoSource {
  return {
    id: data.repo,
    name: data.repo,
    possibleAffordances: ['read'],
    async retrieve() { return []; },
    async get() { return undefined; },
    async getRepoData() { return data; },
  };
}

describe('buildManifest augmentFrom', () => {
  const primaryData = {
    repo: 'acme/local',
    tree: [{ path: 'content/local.md', type: 'blob' as const, size: 7 }],
    authoredContent: {
      'content/local.md': '# Local content\n',
      'notes/guide.md': 'Local guide\n',
    },
    nodemapRaw: 'local nodemap',
    nodemapFiles: {
      'content/local.md': 'local nodemap file\n',
    },
    nodemapDirs: {
      'notes': [{ path: 'notes/guide.md', type: 'blob' as const }],
    },
    listFiles: async () => ['content/local.md'],
    issues: [],
    pullRequests: [],
    commits: [],
    branches: [],
    repoMetadata: null,
    releases: [],
    structuralFiles: {
      '.github/CODEOWNERS': '* @local\n',
    },
    structuredNodeMapRaw: 'local structured',
    contentModel: {
      root: 'content-model',
      files: { 'schema.yaml': 'types: []\n' },
    },
    readme: '# Local README\n',
    themeFileRaw: 'local theme',
  } satisfies RepoData;

  const augmentData = {
    repo: 'acme/live',
    tree: [{ path: 'content/live.md', type: 'blob' as const, size: 11 }],
    authoredContent: {
      'content/live.md': '# Live content\n',
    },
    nodemapRaw: 'live nodemap',
    nodemapFiles: {
      'content/live.md': 'live nodemap file\n',
    },
    nodemapDirs: {
      'content': [{ path: 'content/live.md', type: 'blob' as const }],
    },
    listFiles: async () => ['content/live.md'],
    issues: [{ number: 11, title: 'Live issue', body: 'live', state: 'open', html_url: 'https://example.test/issues/11', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-02T00:00:00.000Z', labels: [] }],
    pullRequests: [{
      number: 22,
      title: 'Live PR',
      body: 'live pr',
      state: 'open',
      labels: [],
      html_url: 'https://example.test/pulls/22',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
      head_branch: 'feature/live',
      user: { login: 'octocat' },
      assignees: [{ login: 'monalisa' }],
    }],
    commits: [{ sha: 'deadbeef', commit: { message: 'live commit', author: { name: 'octocat', date: '2024-01-01T00:00:00.000Z' } }, html_url: 'https://example.test/commit/deadbeef' }],
    branches: [{ name: 'main', protected: true }],
    repoMetadata: {
      name: 'live-repo',
      description: 'Live description',
      html_url: 'https://example.test/live',
      homepage: 'https://example.test',
      default_branch: 'main',
      stargazers_count: 7,
      forks_count: 3,
      private: false,
      topics: ['live'],
      primary_language: 'TypeScript',
      languages: [{ name: 'TypeScript', size: 200 }],
      owner: { login: 'acme', avatar_url: 'https://example.test/avatar.png' },
    },
    releases: [{ tag_name: 'v1.0.0', name: 'v1', body: 'release body', html_url: 'https://example.test/releases/v1', published_at: '2024-01-01T00:00:00.000Z', prerelease: false }],
    structuralFiles: {
      '.github/CODEOWNERS': '* @live\n',
    },
    structuredNodeMapRaw: 'live structured',
    contentModel: {
      root: 'content-model',
      files: { 'schema.yaml': 'types: []\n' },
    },
    readme: '# Live README\n',
    themeFileRaw: 'live theme',
  } satisfies RepoData;

  const primary = makeSource(primaryData);
  const augment = makeSource(augmentData);

  it('overlays live GitHub fields without touching primary content fields', async () => {
    const baseline = await buildManifest(primary, { configRaw: 'title: Primary\n', generatedAt: 'fixed' });
    const augmented = await buildManifest(primary, { configRaw: 'title: Primary\n', generatedAt: 'fixed', augmentFrom: augment });

    expect(augmented.configRaw).toBe(baseline.configRaw);
    expect(augmented.authoredContent).toEqual(baseline.authoredContent);
    expect(augmented.tree).toEqual(baseline.tree);
    expect(augmented.readme).toBe(baseline.readme);
    expect(augmented.structuralFiles).toEqual(baseline.structuralFiles);
    expect(augmented.nodemapRaw).toBe(baseline.nodemapRaw);
    expect(augmented.nodemapFiles).toEqual(baseline.nodemapFiles);
    expect(augmented.nodemapDirs).toEqual(baseline.nodemapDirs);
    expect(augmented.structuredNodeMapRaw).toBe(baseline.structuredNodeMapRaw);
    expect(augmented.contentModel).toEqual(baseline.contentModel);
    expect(augmented.themeFileRaw).toBe(baseline.themeFileRaw);

    expect(augmented.repoMetadata).toEqual(augmentData.repoMetadata);
    expect(augmented.issues).toEqual(augmentData.issues);
    expect(augmented.pullRequests).toEqual(augmentData.pullRequests.map((pr) => ({
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      labels: pr.labels,
      html_url: pr.html_url,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      head_branch: pr.head_branch,
    })));
    expect(augmented.commits).toEqual(augmentData.commits);
    expect(augmented.branches).toEqual(augmentData.branches);
    expect(augmented.releases).toEqual(augmentData.releases);
  });

  it('leaves the primary-only manifest unchanged when augmentFrom is unset', async () => {
    const manifest = await buildManifest(primary, { configRaw: 'title: Primary\n', generatedAt: 'fixed' });

    expect(manifest.configRaw).toBe('title: Primary\n');
    expect(manifest.authoredContent).toEqual(primaryData.authoredContent);
    expect(manifest.tree).toEqual(primaryData.tree);
    expect(manifest.readme).toBe(primaryData.readme);
    expect(manifest.structuralFiles).toEqual(primaryData.structuralFiles);
    expect(manifest.nodemapRaw).toBe(primaryData.nodemapRaw);
    expect(manifest.nodemapFiles).toEqual(primaryData.nodemapFiles);
    expect(manifest.nodemapDirs).toEqual(primaryData.nodemapDirs);
    expect(manifest.structuredNodeMapRaw).toBe(primaryData.structuredNodeMapRaw);
    expect(manifest.contentModel).toEqual(primaryData.contentModel);
    expect(manifest.themeFileRaw).toBe(primaryData.themeFileRaw);

    expect(manifest.issues).toEqual([]);
    expect(manifest.pullRequests).toEqual([]);
    expect(manifest.commits).toEqual([]);
    expect(manifest.branches).toBeUndefined();
    expect(manifest.releases).toBeUndefined();
    expect(manifest.repoMetadata).toBeUndefined();
  });
});
