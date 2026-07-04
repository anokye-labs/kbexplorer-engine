import type { KBConfig, KBGraph, KBNode, GraphStore, GraphStoreEntry, GraphStoreCacheKey } from '@anokye-labs/kbexplorer-core';
import { extractClusters } from '../parser';
import { buildGraph } from '../graph';
import type { ProviderRegistry, ProviderResult } from '../providers';
import {
  applyTransforms,
  DEFAULT_TRANSFORMS,
  type GraphTransform,
  type TransformContext,
} from '../transforms';
import {
  GRAPH_STORE_API_VERSION,
  GRAPH_STORE_CACHE_KEY_VERSION,
} from '@anokye-labs/kbexplorer-core';
import {
  GRAPH_STORE_DERIVATION_VERSION,
  hashProviderResultPrefix,
} from './fingerprint';

export type ProviderCacheKeyBuilder = (
  providerId: string,
  previousContentHash: GraphStoreCacheKey['contentHash'] | undefined,
) => Promise<GraphStoreCacheKey>;

export async function orchestrateWithProviderResultStore(
  registry: ProviderRegistry,
  config: KBConfig,
  ctx: TransformContext,
  store: GraphStore<ProviderResult>,
  buildCacheKey: ProviderCacheKeyBuilder,
  transforms: readonly GraphTransform[] = DEFAULT_TRANSFORMS,
): Promise<KBGraph> {
  const providers = registry.getExecutionOrder();
  let allNodes: KBNode[] = [];
  let previousContentHash: GraphStoreCacheKey['contentHash'] | undefined;

  for (const provider of providers) {
    const key = await buildCacheKey(provider.id, previousContentHash);
    const cached = await store.get(key);
    if (cached) {
      allNodes = cloneProviderResult(
        validateProviderResult(cached.value, `cached graph store entry for ${provider.id}`),
      ).nodes;
      previousContentHash = await hashProviderResultPrefix(provider.id, allNodes);
      continue;
    }

    const result = await provider.resolve(config, allNodes);
    allNodes.push(...result.nodes);
    const value: ProviderResult = cloneProviderResult({ nodes: allNodes, edges: [] });
    await store.put({
      key,
      value,
      dependencies: [dependencyFor(key, previousContentHash)],
      metadata: {
        graphStoreApiVersion: GRAPH_STORE_API_VERSION,
        graphStoreCacheKeyVersion: GRAPH_STORE_CACHE_KEY_VERSION,
        graphStoreDerivationVersion: GRAPH_STORE_DERIVATION_VERSION,
        providerId: provider.id,
      },
    });
    previousContentHash = await hashProviderResultPrefix(provider.id, allNodes);
  }

  const transformed = applyTransforms(allNodes, ctx, transforms);
  return buildGraph(transformed, extractClusters(transformed, config));
}

function dependencyFor(
  key: GraphStoreCacheKey,
  previousContentHash: GraphStoreCacheKey['contentHash'] | undefined,
): NonNullable<GraphStoreEntry<ProviderResult>['dependencies']>[number] {
  return {
    href: previousContentHash ? `${key.sourceId ?? key.providerId}#previous` : key.sourceId ?? key.providerId,
    contentHash: previousContentHash ?? key.contentHash,
    sourceId: key.sourceId ?? key.providerId,
  };
}

function cloneProviderResult(value: ProviderResult): ProviderResult {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as ProviderResult;
}

function validateProviderResult(value: ProviderResult, label: string): ProviderResult {
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error(`Invalid ${label}: expected ProviderResult with nodes and edges arrays.`);
  }
  for (const node of value.nodes) {
    validateNode(node, label);
  }
  return value;
}

function validateNode(node: KBNode, label: string): void {
  if (
    !node ||
    typeof node.id !== 'string' ||
    typeof node.title !== 'string' ||
    typeof node.cluster !== 'string' ||
    !Array.isArray(node.connections)
  ) {
    throw new Error(`Invalid ${label}: malformed KBNode.`);
  }
}
