import { describe, expect, it } from 'vitest';

import {
  buildGraph,
  contentModel,
  identity,
  loadKnowledgeBase,
  nodeTypes,
  orchestrator,
  parser,
  providers,
  queryHelpers,
  transforms,
} from '../src/index';
import { GitHubApiSource, ManifestSource, type RepoSource } from '../src/sources';
import { sqliteProviderResultStore } from '../src/store';

describe('package entrypoints', () => {
  it('exports the scaffolded placeholder entry points', async () => {
    await expect(loadKnowledgeBase()).rejects.toThrow('Not implemented yet: loadKnowledgeBase');
    expect(() => buildGraph()).toThrow('Not implemented yet: buildGraph');

    expect(orchestrator).toBeDefined();
    expect(transforms).toBeDefined();
    expect(providers).toBeDefined();
    expect(nodeTypes).toBeDefined();
    expect(contentModel).toBeDefined();
    expect(identity).toBeDefined();
    expect(parser).toBeDefined();
    expect(queryHelpers).toBeDefined();

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
