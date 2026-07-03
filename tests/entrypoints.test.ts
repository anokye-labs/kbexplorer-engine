import { describe, expect, it } from 'vitest';

import {
  applyTransforms,
  assignIdentity,
  buildGraph,
  DEFAULT_CONFIG,
  DEFAULT_TRANSFORMS,
  extractClusters,
  getRegisteredTypes,
  globToRegex,
  isAccessWithheld,
  parseMarkdownFile,
  registerBuiltInNodeTypes,
  renderSafeMarkdown,
} from '../src/index';
import { GitHubApiSource, ManifestSource, type RepoSource } from '../src/sources';
import { sqliteProviderResultStore } from '../src/store';

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
  });

  it('exports the source/store entry points', () => {
    expect(new ManifestSource()).toBeInstanceOf(ManifestSource);
    expect(new GitHubApiSource()).toBeInstanceOf(GitHubApiSource);

    const repoSource: RepoSource = {
      kind: 'repo',
      url: 'https://example.test/repo',
      fetch,
    };

    expect(repoSource.kind).toBe('repo');
    expect(sqliteProviderResultStore).toBeDefined();
  });
});
