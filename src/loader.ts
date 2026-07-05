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
import type { SqliteByteStore } from './store/sqlite-runtime';

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
 *
 * Two call shapes are supported (distinguished by the first argument):
 *
 *  1. **Positional / advanced** — `loadKnowledgeBase(source, config, env?, options?)`
 *     returns `{ graph, config }`. This is the form the kbexplorer-template
 *     pins by SHA and MUST remain byte-for-byte compatible.
 *
 *  2. **Config-first / scripting** — `loadKnowledgeBase(config, options?)`
 *     returns the bare {@link KBGraph}. The source is taken from
 *     `options.source` when provided, otherwise a default
 *     {@link GitHubApiSource} is constructed from `config.source`. This is the
 *     ergonomic entry for scripts that "just want the graph".
 *
 * The overload is resolved purely by argument shape: a {@link RepoSource} is an
 * object exposing a `getRepoData()` method, whereas a {@link KBConfig} is not.
 */
export interface LoadKnowledgeBaseOptions {
  /**
   * The source to load from. When omitted, a {@link GitHubApiSource} is built
   * from `config.source`. Supply a {@link ManifestSource}, `FileSystemSource`,
   * or any custom {@link RepoSource} to load from elsewhere.
   */
  source?: RepoSource;
  /** Optional engine environment (e.g. GitHub API base) threaded to sources/store. */
  env?: EngineEnv;
  importBaseUrl?: string | URL;
  graphStore?: {
    byteStore?: SqliteByteStore;
    locateFile?: (file: string) => string;
  };
}

type PositionalOptions = {
  importBaseUrl?: string | URL;
  graphStore?: {
    byteStore?: SqliteByteStore;
    locateFile?: (file: string) => string;
  };
};

// Advanced/positional form — unchanged public contract.
export function loadKnowledgeBase(
  source: RepoSource,
  config: KBConfig,
  env?: EngineEnv,
  options?: PositionalOptions,
): Promise<{ graph: KBGraph; config: KBConfig }>;
// Config-first scripting form — returns the bare graph.
export function loadKnowledgeBase(
  config: KBConfig,
  options?: LoadKnowledgeBaseOptions,
): Promise<KBGraph>;
export async function loadKnowledgeBase(
  arg1: RepoSource | KBConfig,
  arg2?: KBConfig | LoadKnowledgeBaseOptions,
  arg3?: EngineEnv,
  arg4?: PositionalOptions,
): Promise<{ graph: KBGraph; config: KBConfig } | KBGraph> {
  if (isRepoSource(arg1)) {
    return loadFromSource(arg1, arg2 as KBConfig, arg3, arg4);
  }

  // Config-first: arg1 is the config, arg2 is the scripting options bag.
  const config = arg1;
  const options = (arg2 as LoadKnowledgeBaseOptions | undefined) ?? {};
  const source = options.source ?? (await defaultSourceFor(config));

  const positionalOptions: PositionalOptions = {};
  if (options.importBaseUrl !== undefined) positionalOptions.importBaseUrl = options.importBaseUrl;
  if (options.graphStore !== undefined) positionalOptions.graphStore = options.graphStore;

  const { graph } = await loadFromSource(source, config, options.env, positionalOptions);
  return graph;
}

/** Structural test for the positional form: a {@link RepoSource} carries `getRepoData`. */
function isRepoSource(value: RepoSource | KBConfig): value is RepoSource {
  return typeof (value as Partial<RepoSource>).getRepoData === 'function';
}

/**
 * Build the default {@link RepoSource} for the config-first form: a live
 * {@link GitHubApiSource} over `config.source`. Imported lazily so scripts that
 * always pass their own `options.source` never pull the GitHub client path in.
 */
async function defaultSourceFor(config: KBConfig): Promise<RepoSource> {
  const { GitHubApiSource } = await import('./sources/github-api-source');
  return new GitHubApiSource(config.source);
}

/**
 * Core loader body (shared by both call shapes). Wires providers from the
 * source's {@link RepoData} bundle, runs external providers declared in config,
 * and executes the shared transform/store stage.
 */
async function loadFromSource(
  source: RepoSource,
  config: KBConfig,
  env?: EngineEnv,
  options?: PositionalOptions,
): Promise<{ graph: KBGraph; config: KBConfig }> {
  const data = await source.getRepoData();

  const registry = new ProviderRegistry();
  registerProviders(registry, data);

  // External providers declared in config (local-ES-module first; F5).
  if (config.providers && config.providers.length > 0) {
    const { loadExternalProviders } = await import('./plugin-loader');
    const externals = await loadExternalProviders(
      config.providers,
      options?.importBaseUrl !== undefined ? { importBaseUrl: options.importBaseUrl } : undefined,
    );
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
    const store = await SQLiteGraphStore.create(options?.graphStore?.byteStore, options?.graphStore?.locateFile);
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
