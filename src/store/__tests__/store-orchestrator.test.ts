import { describe, expect, it } from 'vitest';
import type {
  GraphStore,
  GraphStoreCacheKey,
  GraphStoreEntry,
  GraphStoreInvalidation,
  GraphStoreWrite,
  KBConfig,
  KBNode,
} from '../../../types';
import { ProviderRegistry, type GraphProvider, type ProviderResult } from '../../providers';
import { orchestrateWithProviderResultStore } from '../store-orchestrator';

const key: GraphStoreCacheKey = {
  scope: 'provider-result',
  providerId: 'provider-pipeline',
  sourceId: 'test',
  variant: 'test',
  contentHash: { algorithm: 'sha256', digest: 'abc', encoding: 'hex' },
};

const config = {
  clusters: {
    default: { name: 'Default', color: '#ccc' },
  },
} as unknown as KBConfig;

function node(id: string): KBNode {
  return {
    id,
    title: id,
    cluster: 'default',
    content: '',
    rawContent: '',
    connections: [],
    source: { type: 'readme' },
  };
}

class MemoryGraphStore implements GraphStore<ProviderResult> {
  entries = new Map<string, GraphStoreEntry<ProviderResult>>();
  putCount = 0;

  async get(key: GraphStoreCacheKey): Promise<GraphStoreEntry<ProviderResult> | undefined> {
    return this.entries.get(`${key.providerId}:${key.contentHash.digest}`);
  }

  async put(entry: GraphStoreWrite<ProviderResult>): Promise<void> {
    this.putCount++;
    this.entries.set(`${entry.key.providerId}:${entry.key.contentHash.digest}`, {
      ...entry,
      createdAt: entry.createdAt ?? 'created',
      updatedAt: entry.updatedAt ?? 'updated',
    });
  }

  async delete(key: GraphStoreCacheKey): Promise<boolean> {
    return this.entries.delete(`${key.providerId}:${key.contentHash.digest}`);
  }

  async invalidate(match: GraphStoreInvalidation): Promise<number> {
    let deleted = 0;
    for (const [cacheKey, entry] of this.entries) {
      if (
        (!match.scope || match.scope === entry.key.scope) &&
        (!match.providerId || match.providerId === entry.key.providerId) &&
        (!match.sourceId || match.sourceId === entry.key.sourceId) &&
        (!match.variant || match.variant === entry.key.variant) &&
        (!match.contentHash || match.contentHash.digest === entry.key.contentHash.digest)
      ) {
        this.entries.delete(cacheKey);
        deleted++;
      }
    }
    return deleted;
  }
}

class CountingProvider implements GraphProvider {
  id: string;
  name = 'Counting';
  calls = 0;
  value: string;

  constructor(id = 'counting', value = 'from-provider') {
    this.id = id;
    this.value = value;
  }

  async resolve(): Promise<ProviderResult> {
    this.calls++;
    return { nodes: [node(this.value)], edges: [] };
  }
}

function keyFor(providerId: string, digest = providerId): GraphStoreCacheKey {
  return {
    ...key,
    providerId,
    contentHash: { algorithm: 'sha256', digest, encoding: 'hex' },
  };
}

describe('orchestrateWithProviderResultStore', () => {
  it('returns cached provider results without running providers', async () => {
    const provider = new CountingProvider();
    const registry = new ProviderRegistry();
    registry.register(provider);
    const store = new MemoryGraphStore();
    store.entries.set('counting:counting', {
      key: keyFor('counting'),
      value: { nodes: [node('from-cache')], edges: [] },
    });

    const graph = await orchestrateWithProviderResultStore(
      registry,
      config,
      { readme: null },
      store,
      async providerId => keyFor(providerId),
    );

    expect(provider.calls).toBe(0);
    expect(graph.nodes.map(n => n.id)).toEqual(['from-cache']);
    expect(store.putCount).toBe(0);
  });

  it('runs providers on miss and writes transformed provider results', async () => {
    const provider = new CountingProvider();
    const registry = new ProviderRegistry();
    registry.register(provider);
    const store = new MemoryGraphStore();

    const graph = await orchestrateWithProviderResultStore(
      registry,
      config,
      { readme: null },
      store,
      async providerId => keyFor(providerId),
    );

    expect(provider.calls).toBe(1);
    expect(store.putCount).toBe(1);
    expect(store.entries.get('counting:counting')?.value.nodes.map(n => n.id)).toEqual(['from-provider']);
    expect(graph.nodes.map(n => n.id)).toEqual(['from-provider']);
  });

  it('reuses unchanged provider prefixes and recomputes from the first changed provider onward', async () => {
    const providers = [
      new CountingProvider('files', 'from-files'),
      new CountingProvider('work', 'from-work-v2'),
      new CountingProvider('person', 'from-person-v2'),
    ];
    const registry = new ProviderRegistry();
    for (const provider of providers) registry.register(provider);
    const store = new MemoryGraphStore();
    store.entries.set('files:files', {
      key: keyFor('files'),
      value: { nodes: [node('from-files')], edges: [] },
    });
    store.entries.set('work:work-v1', {
      key: keyFor('work', 'work-v1'),
      value: { nodes: [node('from-files'), node('from-work-v1')], edges: [] },
    });

    const graph = await orchestrateWithProviderResultStore(
      registry,
      config,
      { readme: null },
      store,
      async (providerId) => keyFor(providerId, providerId === 'work' ? 'work-v2' : providerId),
    );

    expect(providers.map(p => p.calls)).toEqual([0, 1, 1]);
    expect(graph.nodes.map(n => n.id)).toEqual(['from-files', 'from-work-v2', 'from-person-v2']);
    expect(store.entries.has('work:work-v2')).toBe(true);
    expect(store.entries.has('person:person')).toBe(true);
  });

  it('surfaces malformed cached provider results', async () => {
    const registry = new ProviderRegistry();
    registry.register(new CountingProvider());
    const store = new MemoryGraphStore();
    store.entries.set('counting:counting', {
      key: keyFor('counting'),
      value: { nodes: undefined, edges: [] } as unknown as ProviderResult,
    });

    await expect(orchestrateWithProviderResultStore(
      registry,
      config,
      { readme: null },
      store,
      async providerId => keyFor(providerId),
    ))
      .rejects.toThrow('Invalid cached graph store entry');
  });
});
