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
  entry?: GraphStoreEntry<ProviderResult>;
  putCount = 0;

  async get(): Promise<GraphStoreEntry<ProviderResult> | undefined> {
    return this.entry;
  }

  async put(entry: GraphStoreWrite<ProviderResult>): Promise<void> {
    this.putCount++;
    this.entry = {
      ...entry,
      createdAt: entry.createdAt ?? 'created',
      updatedAt: entry.updatedAt ?? 'updated',
    };
  }

  async delete(): Promise<boolean> {
    const existed = this.entry !== undefined;
    this.entry = undefined;
    return existed;
  }

  async invalidate(_match: GraphStoreInvalidation): Promise<number> {
    return await this.delete() ? 1 : 0;
  }
}

class CountingProvider implements GraphProvider {
  id = 'counting';
  name = 'Counting';
  calls = 0;

  async resolve(): Promise<ProviderResult> {
    this.calls++;
    return { nodes: [node('from-provider')], edges: [] };
  }
}

describe('orchestrateWithProviderResultStore', () => {
  it('returns cached provider results without running providers', async () => {
    const provider = new CountingProvider();
    const registry = new ProviderRegistry();
    registry.register(provider);
    const store = new MemoryGraphStore();
    store.entry = {
      key,
      value: { nodes: [node('from-cache')], edges: [] },
    };

    const graph = await orchestrateWithProviderResultStore(registry, config, { readme: null }, store, key);

    expect(provider.calls).toBe(0);
    expect(graph.nodes.map(n => n.id)).toEqual(['from-cache']);
    expect(store.putCount).toBe(0);
  });

  it('runs providers on miss and writes transformed provider results', async () => {
    const provider = new CountingProvider();
    const registry = new ProviderRegistry();
    registry.register(provider);
    const store = new MemoryGraphStore();

    const graph = await orchestrateWithProviderResultStore(registry, config, { readme: null }, store, key);

    expect(provider.calls).toBe(1);
    expect(store.putCount).toBe(1);
    expect(store.entry?.value.nodes.map(n => n.id)).toEqual(['from-provider']);
    expect(graph.nodes.map(n => n.id)).toEqual(['from-provider']);
  });

  it('surfaces malformed cached provider results', async () => {
    const registry = new ProviderRegistry();
    const store = new MemoryGraphStore();
    store.entry = {
      key,
      value: { nodes: undefined, edges: [] } as unknown as ProviderResult,
    };

    await expect(orchestrateWithProviderResultStore(registry, config, { readme: null }, store, key))
      .rejects.toThrow('Invalid cached graph store entry');
  });
});
