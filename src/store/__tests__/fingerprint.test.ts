import { describe, expect, it } from 'vitest';
import type { KBConfig } from '@anokye-labs/kbexplorer-core';
import { DEFAULT_CONFIG } from '../../default-config';
import type { RepoData, RepoSource } from '../../sources/repo-data';
import { buildProviderResultCacheKey } from '../fingerprint';

const source: RepoSource = {
  id: 'manifest',
  name: 'Manifest',
  possibleAffordances: ['read'],
  async retrieve() { return []; },
  async get() { return undefined; },
  async getRepoData() { return data; },
};

const config: KBConfig = {
  ...DEFAULT_CONFIG,
  source: { ...DEFAULT_CONFIG.source, owner: 'anokye-labs', repo: 'kbexplorer-template', branch: 'main' },
};

const data: RepoData = {
  repo: 'kbexplorer-template',
  tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: 'a', size: 1, url: 'https://example.test/tree/readme' }],
  authoredContent: { 'content/a.md': '# A' },
  nodemapRaw: null,
  nodemapFiles: {},
  nodemapDirs: {},
  listFiles: async () => [],
  issues: [{
    number: 1,
    title: 'Issue',
    body: 'Body',
    state: 'open',
    labels: [],
    assignees: [],
    html_url: 'https://example.test/1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }],
  pullRequests: [],
  commits: [],
  branches: [],
  repoMetadata: null,
  releases: [],
  structuralFiles: {},
  structuredNodeMapRaw: null,
  contentModel: null,
  readme: '# Readme',
};

describe('graph store fingerprints', () => {
  it('is stable for unchanged provider inputs', async () => {
    const first = await buildProviderResultCacheKey(source, config, data, 'files');
    const second = await buildProviderResultCacheKey(source, config, data, 'files');

    expect(second).toEqual(first);
  });

  it('scopes source changes to the provider data slice', async () => {
    const changedTree = {
      ...data,
      tree: [{ path: 'README.md', mode: '100644', type: 'blob' as const, sha: 'b', size: 1, url: 'https://example.test/tree/readme' }],
    };

    const filesBefore = await buildProviderResultCacheKey(source, config, data, 'files');
    const filesAfter = await buildProviderResultCacheKey(source, config, changedTree, 'files');
    const workBefore = await buildProviderResultCacheKey(source, config, data, 'work');
    const workAfter = await buildProviderResultCacheKey(source, config, changedTree, 'work');

    expect(filesAfter.contentHash.digest).not.toBe(filesBefore.contentHash.digest);
    expect(workAfter.contentHash.digest).toBe(workBefore.contentHash.digest);
  });

  it('invalidates provider and config fingerprints independently', async () => {
    const changedIssue = {
      ...data,
      issues: [{ ...data.issues[0]!, title: 'Changed issue' }],
    };
    const changedConfig = {
      ...config,
      people: { minActiveItems: 2 },
    } satisfies KBConfig;

    const workBefore = await buildProviderResultCacheKey(source, config, data, 'work');
    const workAfter = await buildProviderResultCacheKey(source, config, changedIssue, 'work');
    const filesBefore = await buildProviderResultCacheKey(source, config, data, 'files');
    const filesAfterConfig = await buildProviderResultCacheKey(source, changedConfig, data, 'files');

    expect(workAfter.contentHash.digest).not.toBe(workBefore.contentHash.digest);
    expect(filesAfterConfig.contentHash.digest).not.toBe(filesBefore.contentHash.digest);
    expect(workBefore.providerId).toBe('work');
    expect(filesBefore.providerId).toBe('files');
  });
});
