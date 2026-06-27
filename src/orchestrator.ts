/**
 * Provider orchestrator — runs registered providers in dependency order
 * and merges their results into a unified KBGraph.
 */
import type { KBNode, KBGraph, KBConfig } from '../types';
import type { ProviderRegistry } from './providers';
import { extractClusters } from './parser';
import { buildGraph } from './graph';
import {
  applyTransforms,
  DEFAULT_TRANSFORMS,
  type GraphTransform,
  type TransformContext,
} from './transforms';

/**
 * Run all registered providers in dependency order and collect their nodes.
 * Lower-level helper for callers that need to apply transforms before
 * building the final graph.
 */
export async function collectProviderNodes(
  registry: ProviderRegistry,
  config: KBConfig,
): Promise<KBNode[]> {
  const providers = registry.getExecutionOrder();
  const allNodes: KBNode[] = [];

  for (const provider of providers) {
    const result = await provider.resolve(config, allNodes);
    allNodes.push(...result.nodes);
  }

  return allNodes;
}

/**
 * Run all registered providers in dependency order and merge their
 * results into a unified KBGraph.
 */
export async function orchestrate(
  registry: ProviderRegistry,
  config: KBConfig,
): Promise<KBGraph> {
  const allNodes = await collectProviderNodes(registry, config);
  const clusters = extractClusters(allNodes, config);
  return buildGraph(allNodes, clusters);
}

/**
 * Run providers, then the ordered post-provider transform stage, then build the
 * final graph. This is the single assembly path shared by the local and remote
 * loaders: they wire providers + a {@link TransformContext} and call this; all
 * post-processing (README synthesis, issue→directory linking, issue splitting)
 * lives in the transforms, not the loaders.
 */
export async function orchestrateWithTransforms(
  registry: ProviderRegistry,
  config: KBConfig,
  ctx: TransformContext,
  transforms: readonly GraphTransform[] = DEFAULT_TRANSFORMS,
): Promise<KBGraph> {
  const allNodes = await collectProviderNodes(registry, config);
  const transformed = applyTransforms(allNodes, ctx, transforms);
  const clusters = extractClusters(transformed, config);
  return buildGraph(transformed, clusters);
}
