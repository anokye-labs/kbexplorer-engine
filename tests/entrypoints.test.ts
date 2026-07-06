import { describe, expect, it } from 'vitest';

import {
  applyTransforms,
  assignIdentity,
  buildGraph,
  compareContent,
  DEFAULT_CONFIG,
  DEFAULT_TRANSFORMS,
  deriveNeeds,
  enrichFromManifest,
  extractClusters,
  getRegisteredTypes,
  globToRegex,
  isAccessWithheld,
  parseMarkdownFile,
  registerBuiltInNodeTypes,
  renderSafeMarkdown,
} from '../src/index';
import { GitHubApiSource, ManifestSource, type RepoData, type RepoSource, type RepoManifest } from '../src/sources';
import { resolveGraphStoreOptions } from '../src/store';

describe('package entrypoints', () => {
  it('exports the real slice-1 pipeline-core public API', () => {
    // graph.ts
    expect(buildGraph([], [])).toEqual({ nodes: [], edges: [], clusters: [], related: {} });

    // parser.ts
    const node = parseMarkdownFile('docs/hello.md', '# Hello\n\nBody text.');
    expect(node.id).toBeDefined();

    // identity.ts
    expect(typeof assignIdentity(node)).toBe('string');

    // access.ts
    expect(isAccessWithheld({})).toBe(false);

    // transforms.ts
    expect(DEFAULT_TRANSFORMS.length).toBeGreaterThan(0);
    expect(applyTransforms([], { readme: null })).toEqual([]);

    // safe-markdown.ts
    expect(renderSafeMarkdown('**bold**')).toContain('<strong>');

    // glob.ts
    expect(globToRegex('*.md').test('readme.md')).toBe(true);

    // default-config.ts
    expect(DEFAULT_CONFIG.title).toBeDefined();

    // node-types/
    registerBuiltInNodeTypes();
    expect(getRegisteredTypes().length).toBeGreaterThan(0);

    // extractClusters — parser.ts
    expect(extractClusters([node], DEFAULT_CONFIG)).toBeDefined();

    // catalogue/ (anokye-labs/kbexplorer-engine#19)
    const catalogue = { nodes: [{ id: 'a', authored: true }] };
    expect(deriveNeeds(catalogue, {})).toEqual({ total: 1, authored: 1, derived: 0, nodes: [] });
    expect(compareContent(catalogue, {}).missingNodes).toHaveLength(1);
    expect(
      enrichFromManifest(catalogue, {
        configRaw: null,
        authoredContent: {},
        tree: [],
        readme: null,
        issues: [],
        pullRequests: [],
        commits: [],
        generatedAt: '',
      }).summary.totalNodes,
    ).toBe(1);
  });

  it('exports the source/store entry points', () => {
    const manifest = {
      configRaw: null,
      authoredContent: {},
      tree: [],
      readme: null,
      issues: [],
      pullRequests: [],
      commits: [],
      generatedAt: '',
    } as unknown as RepoManifest;
    expect(new ManifestSource(manifest, DEFAULT_CONFIG)).toBeInstanceOf(ManifestSource);
    expect(new GitHubApiSource(DEFAULT_CONFIG.source)).toBeInstanceOf(GitHubApiSource);

    const repoData: RepoData = {
      repo: 'acme/demo-repo',
      tree: [],
      authoredContent: {},
      nodemapRaw: null,
      listFiles: async () => [],
      issues: [],
      pullRequests: [],
      commits: [],
      branches: [],
      repoMetadata: null,
      releases: [],
      structuralFiles: {},
      structuredNodeMapRaw: null,
      contentModel: null,
      readme: null,
    };

    const repoSource: RepoSource = {
      id: 'entrypoints-smoke',
      name: 'Entrypoints smoke source',
      possibleAffordances: ['read'],
      async retrieve() {
        return [];
      },
      async getRepoData() {
        return repoData;
      },
    };

    expect(repoSource.id).toBe('entrypoints-smoke');
    expect(resolveGraphStoreOptions().mode).toBe('off');
  });
});
