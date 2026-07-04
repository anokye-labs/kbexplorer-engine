/**
 * Unified knowledge-base loader (Phase 4 / F4 #318).
 *
 * Collapses the former local + remote loaders into a single entrypoint:
 * `loadKnowledgeBase(source, config)`. The {@link RepoSource} abstracts *where*
 * the data comes from (a manifest, the GitHub API, a future custom SoR); this
 * function wires the providers from the source's {@link RepoData} bundle and
 * runs the shared transform stage. Provider wiring is conditional on what the
 * bundle actually carries, so each source produces byte-identical output to its
 * former dedicated loader.
 */
import type { KBGraph, KBConfig } from '@anokye-labs/kbexplorer-core';
import { ProviderRegistry } from './providers';
import { FilesProvider } from './providers/files-provider';
import { AuthoredProvider } from './providers/authored-provider';
import { AuthoredRichMarkdownProvider } from './providers/authored-rich-markdown-provider';
import { WorkProvider } from './providers/work-provider';
import { PersonProvider } from './providers/person-provider';
import { StructuralProvider } from './providers/structural-provider';
import { ContentModelProvider } from './providers/content-model-provider';
import { orchestrateWithTransforms } from './orchestrator';
import type { RepoSource, RepoData } from './sources/repo-data';
import { resolveGraphStoreOptions } from './store/config';
import type { EngineEnv } from './env';
import { buildProviderResultCacheKey } from './store/fingerprint';

/** Build + register the provider pipeline from a normalized {@link RepoData} bundle. */
export function registerProviders(registry: ProviderRegistry, data: RepoData): void {
  if (data.tree.length > 0) {
    registry.register(new FilesProvider(data.tree, data.repo));
  }

  if (Object.keys(data.authoredContent).length > 0 || data.nodemapRaw) {
    registry.register(new AuthoredProvider(
      data.authoredContent,
      data.nodemapRaw,
      data.nodemapFiles,
      data.nodemapDirs,
      data.listFiles,
    ));
  }

  // Authored docs opting into rich-Markdown (`display: rich-markdown`) are
  // ingested into rich-md nodes (data.richMarkdown.blocks) by the published
  // provider's pure `./lib`; AuthoredProvider skips these (no double-emit).
  if (Object.keys(data.authoredContent).length > 0) {
    registry.register(new AuthoredRichMarkdownProvider(data.authoredContent));
  }

  const workPRs = data.pullRequests.map(pr => ({
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state,
    labels: pr.labels,
    html_url: pr.html_url,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    ...(pr.head_branch !== undefined ? { head_branch: pr.head_branch } : {}),
    ...(pr.user !== undefined ? { user: pr.user } : {}),
  }));
  registry.register(new WorkProvider(
    data.issues,
    workPRs,
    data.commits,
    data.branches,
    data.repoMetadata,
    data.releases,
  ));

  registry.register(new PersonProvider(
    data.issues,
    data.pullRequests.map(pr => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      html_url: pr.html_url,
      ...(pr.user !== undefined ? { user: pr.user } : {}),
      ...(pr.assignees !== undefined ? { assignees: pr.assignees } : {}),
    })),
  ));

  if (Object.keys(data.structuralFiles).length > 0) {
    registry.register(new StructuralProvider(data.structuralFiles, data.structuredNodeMapRaw));
  }

  registry.register(new ContentModelProvider(data.contentModel));
}

/**
 * Load a knowledge base from any {@link RepoSource}. Single replacement for the
 * former `loadLocalKnowledgeBase` / `loadRemoteKnowledgeBase` bodies.
 */
export async function loadKnowledgeBase(
  source: RepoSource,
  config: KBConfig,
  env?: EngineEnv,
): Promise<{ graph: KBGraph; config: KBConfig }> {
  const data = await source.getRepoData();

  const registry = new ProviderRegistry();
  registerProviders(registry, data);

  // External providers declared in config (local-ES-module first; F5).
  if (config.providers && config.providers.length > 0) {
    const { loadExternalProviders } = await import('./plugin-loader');
    const externals = await loadExternalProviders(config.providers);
    for (const p of externals) registry.register(p);
  }

  const storeOptions = resolveGraphStoreOptions(env);
  if (storeOptions.mode === 'sqlite') {
    const [
      { SQLiteGraphStore },
      { orchestrateWithProviderResultStore },
    ] = await Promise.all([
      import('./store/sqlite-graph-store'),
      import('./store/store-orchestrator'),
    ]);
    const store = await SQLiteGraphStore.create();
    const graph = await orchestrateWithProviderResultStore(
      registry,
      config,
      { readme: data.readme },
      store,
      (providerId, previousContentHash) =>
        buildProviderResultCacheKey(source, config, data, providerId, previousContentHash),
    );
    return { graph, config };
  }

  const graph = await orchestrateWithTransforms(registry, config, { readme: data.readme });
  return { graph, config };
}
