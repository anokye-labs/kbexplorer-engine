import { describe, expect, it } from 'vitest';
import type { GraphStoreCacheKey } from '@anokye-labs/kbexplorer-core';
import type { ProviderResult } from '../../providers';
import { formatGraphStoreCacheKey } from '@anokye-labs/kbexplorer-core';
import { MemorySqliteByteStore } from '../sqlite-runtime';
import { SQLiteGraphStore } from '../sqlite-graph-store';

const key: GraphStoreCacheKey = {
  scope: 'provider-result',
  providerId: 'provider-pipeline',
  sourceId: 'github-api:anokye-labs/kbexplorer-template:main:',
  variant: 'test',
  contentHash: {
    algorithm: 'sha256',
    digest: 'abc123',
    encoding: 'hex',
  },
};

const value: ProviderResult = {
  nodes: [{
    id: 'a',
    title: 'A',
    cluster: 'default',
    content: '',
    rawContent: '',
    connections: [],
    source: { type: 'readme' },
  }],
  edges: [],
};

describe('SQLiteGraphStore', () => {
  it('round-trips provider results and persists through the byte store', async () => {
    const bytes = new MemorySqliteByteStore();
    const first = await SQLiteGraphStore.create<ProviderResult>(bytes);

    await first.put({ key, value, metadata: { test: true } });
    expect((await first.get(key))?.value).toEqual(value);

    const second = await SQLiteGraphStore.create<ProviderResult>(bytes);
    const loaded = await second.get(key);
    expect(loaded?.value).toEqual(value);
    expect(loaded?.metadata).toEqual({ test: true });
    expect(formatGraphStoreCacheKey(loaded!.key)).toBe(formatGraphStoreCacheKey(key));
  });

  it('deletes exact cache keys', async () => {
    const store = await SQLiteGraphStore.create<ProviderResult>(new MemorySqliteByteStore());
    await store.put({ key, value });

    expect(await store.delete(key)).toBe(true);
    expect(await store.get(key)).toBeUndefined();
    expect(await store.delete(key)).toBe(false);
  });

  it('invalidates by scope, source, provider, variant, and dependency hash', async () => {
    const store = await SQLiteGraphStore.create<ProviderResult>(new MemorySqliteByteStore());
    await store.put({
      key,
      value,
      dependencies: [{
        href: 'git://kbexplorer-template/README.md',
        sourceId: 'readme',
        contentHash: { algorithm: 'sha256', digest: 'dep456', encoding: 'hex' },
      }],
    });

    expect(await store.invalidate({
      scope: 'provider-result',
      providerId: 'provider-pipeline',
      sourceId: 'readme',
      variant: 'test',
      contentHash: { algorithm: 'sha256', digest: 'dep456', encoding: 'hex' },
    })).toBe(1);
    expect(await store.get(key)).toBeUndefined();
  });
});
