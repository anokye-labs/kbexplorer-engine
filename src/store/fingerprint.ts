import type { KBConfig, ContentHash, GraphStoreCacheKey } from '@anokye-labs/kbexplorer-core';
import {
  GRAPH_STORE_API_VERSION,
  GRAPH_STORE_CACHE_KEY_VERSION,
} from '@anokye-labs/kbexplorer-core';
import type { RepoData, RepoSource } from '../sources/repo-data';

// v3: #452 — the shared defensive markdown renderer switched from escape-all to
// an allowlist HTML sanitizer (marked → sanitize-html). Legitimate embedded HTML
// (<details>/<summary>, <img> badges, <table>, <picture>/<source>) now renders
// as live safe markup instead of escaped text, and entity-encoded scheme colons
// are normalized-then-defanged. This changes derived `content` HTML for any node
// whose source carried raw HTML, so persisted v2 provider results (pre-allowlist
// HTML) would replay stale renders and must miss.
// v2: #445/#446 wave — identity unification changed content-model/rich-md/
// external node id+identity shapes, the shared defensive markdown renderer
// changed derived content HTML for the same inputs, and authored docs now
// derive an `access` label from frontmatter. Persisted v1 provider results
// would replay pre-sanitizer HTML and unlabeled nodes, so they must miss.
export const GRAPH_STORE_DERIVATION_VERSION = 'template-graph-derivation-v3';
export const GRAPH_STORE_PROVIDER_ID = 'provider-pipeline';

export function buildProviderResultCacheKey(
  source: RepoSource,
  config: KBConfig,
  data: RepoData,
  providerId: string = GRAPH_STORE_PROVIDER_ID,
  previousContentHash?: ContentHash,
): Promise<GraphStoreCacheKey> {
  return contentHashFor({
    apiVersion: GRAPH_STORE_API_VERSION,
    cacheKeyVersion: GRAPH_STORE_CACHE_KEY_VERSION,
    derivationVersion: GRAPH_STORE_DERIVATION_VERSION,
    sourceId: source.id,
    providerId,
    previousContentHash,
    config,
    data: stableProviderData(data, providerId),
  }).then(contentHash => ({
    scope: 'provider-result',
    providerId,
    sourceId: sourceIdFor(source, config),
    contentHash,
    variant: [
      GRAPH_STORE_API_VERSION,
      GRAPH_STORE_CACHE_KEY_VERSION,
      GRAPH_STORE_DERIVATION_VERSION,
    ].join(':'),
  }));
}

export function hashProviderResultPrefix(providerId: string, nodes: unknown): Promise<ContentHash> {
  return contentHashFor({
    apiVersion: GRAPH_STORE_API_VERSION,
    cacheKeyVersion: GRAPH_STORE_CACHE_KEY_VERSION,
    derivationVersion: GRAPH_STORE_DERIVATION_VERSION,
    providerId,
    nodes,
  });
}

export function sourceIdFor(source: RepoSource, config: KBConfig): string {
  const sourceConfig = config.source;
  return [
    source.id,
    sourceConfig.owner,
    sourceConfig.repo,
    sourceConfig.branch ?? 'main',
    sourceConfig.path ?? '',
  ].join(':');
}

export async function contentHashFor(value: unknown): Promise<ContentHash> {
  const crypto = globalThis.crypto?.subtle;
  if (!crypto) {
    throw new Error('Graph store hashing requires Web Crypto SubtleCrypto support.');
  }
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.digest('SHA-256', bytes);
  return {
    algorithm: 'sha256',
    digest: bytesToHex(new Uint8Array(digest)),
    encoding: 'hex',
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function stableRepoData(data: RepoData): unknown {
  return {
    repo: data.repo,
    tree: data.tree.map(item => ({
      path: item.path,
      mode: item.mode,
      type: item.type,
      sha: item.sha,
      size: item.size,
    })),
    authoredContent: data.authoredContent,
    nodemapRaw: data.nodemapRaw,
    nodemapFiles: data.nodemapFiles,
    nodemapDirs: data.nodemapDirs,
    issues: data.issues.map(issue => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: issue.labels,
      assignees: issue.assignees,
      user: issue.user,
      html_url: issue.html_url,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
    })),
    pullRequests: data.pullRequests,
    commits: data.commits,
    branches: data.branches,
    repoMetadata: data.repoMetadata,
    releases: data.releases,
    structuralFiles: data.structuralFiles,
    structuredNodeMapRaw: data.structuredNodeMapRaw,
    contentModel: data.contentModel,
    readme: data.readme,
  };
}

function stableProviderData(data: RepoData, providerId: string): unknown {
  switch (providerId) {
    case 'files':
      return {
        repo: data.repo,
        tree: data.tree.map(item => ({
          path: item.path,
          mode: item.mode,
          type: item.type,
          sha: item.sha,
          size: item.size,
        })),
      };
    case 'authored':
      return {
        authoredContent: data.authoredContent,
        nodemapRaw: data.nodemapRaw,
        nodemapFiles: data.nodemapFiles,
        nodemapDirs: data.nodemapDirs,
      };
    case 'work':
      return {
        issues: data.issues.map(issue => ({
          number: issue.number,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          labels: issue.labels,
          assignees: issue.assignees,
          user: issue.user,
          html_url: issue.html_url,
          created_at: issue.created_at,
          updated_at: issue.updated_at,
        })),
        pullRequests: data.pullRequests,
        commits: data.commits,
        branches: data.branches,
        repoMetadata: data.repoMetadata,
        releases: data.releases,
      };
    case 'content-model':
      return {
        contentModel: data.contentModel,
      };
    case 'person':
      return {
        issues: data.issues.map(issue => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          assignees: issue.assignees,
          user: issue.user,
        })),
        pullRequests: data.pullRequests.map(pr => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          html_url: pr.html_url,
          user: pr.user,
          assignees: pr.assignees,
        })),
      };
    case 'structural':
      return {
        structuralFiles: data.structuralFiles,
        structuredNodeMapRaw: data.structuredNodeMapRaw,
      };
    default:
      return stableRepoData(data);
  }
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
}

function normalizeForJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForJson);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (typeof item !== 'function' && item !== undefined) {
      out[key] = normalizeForJson(item);
    }
  }
  return out;
}
