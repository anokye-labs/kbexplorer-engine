/**
 * Provider orchestrator — runs registered providers in dependency order
 * and merges their results into a unified KBGraph.
 */
import type { KBNode, KBGraph, KBConfig } from '../types';
import type { ProviderRegistry } from './providers';
import { extractClusters } from './parser';
import { buildGraph } from './graph';

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
