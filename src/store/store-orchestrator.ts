import type { KBConfig, KBGraph, KBNode, GraphStore } from '../../types';
import { extractClusters } from '../parser';
import { buildGraph } from '../graph';
import type { ProviderRegistry, ProviderResult } from '../providers';
import {
  collectProviderNodes,
} from '../orchestrator';
import {
  applyTransforms,
  DEFAULT_TRANSFORMS,
  type GraphTransform,
  type TransformContext,
} from '../transforms';
import type { GraphStoreCacheKey } from '../../types';
import {
  GRAPH_STORE_API_VERSION,
  GRAPH_STORE_CACHE_KEY_VERSION,
} from '../../types';
import { GRAPH_STORE_DERIVATION_VERSION } from './fingerprint';

export async function orchestrateWithProviderResultStore(
  registry: ProviderRegistry,
  config: KBConfig,
  ctx: TransformContext,
  store: GraphStore<ProviderResult>,
  key: GraphStoreCacheKey,
  transforms: readonly GraphTransform[] = DEFAULT_TRANSFORMS,
): Promise<KBGraph> {
  const cached = await store.get(key);
  if (cached) {
    const nodes = validateProviderResult(cached.value, 'cached graph store entry').nodes;
    return buildGraph(nodes, extractClusters(nodes, config));
  }

  const allNodes = await collectProviderNodes(registry, config);
  const transformed = applyTransforms(allNodes, ctx, transforms);
  const value: ProviderResult = { nodes: transformed, edges: [] };
  await store.put({
    key,
    value,
    dependencies: [{
      href: key.sourceId ?? key.providerId,
      contentHash: key.contentHash,
      sourceId: key.sourceId,
    }],
    metadata: {
      graphStoreApiVersion: GRAPH_STORE_API_VERSION,
      graphStoreCacheKeyVersion: GRAPH_STORE_CACHE_KEY_VERSION,
      graphStoreDerivationVersion: GRAPH_STORE_DERIVATION_VERSION,
    },
  });
  return buildGraph(transformed, extractClusters(transformed, config));
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
