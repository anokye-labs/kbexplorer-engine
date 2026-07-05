/**
 * GitHubApiSource (Phase 4 / F4 #321, #322; moved in
 * anokye-labs/kbexplorer-template#472, slice 4/5).
 *
 * A composite {@link RepoSource} over the live GitHub API. It is deliberately a
 * *composite* of two resource families that are never conflated:
 *
 *  • **Git** resources — `file` / `tree` / `commit` / `staging-area`, with the
 *    git-worktree affordances `read` / `write` / `stage`. Addressed `git://`.
 *  • **GitHub** resources — `issue` / `pull-request` / `release`, with their own
 *    operations (`comment` / `close` / `merge`). Addressed `github://`.
 *
 * Affordances are **per-retrieval**: the same file comes back `['read']` from a
 * plain read, `['read','write','stage']` when retrieved against a writable
 * worktree, and — once staged — additionally carries a first-class
 * `{ rel: 'staging-area', href }` link to the retrievable staging area. PR
 * draft/proposed/merge states are GitHub concepts and never appear as git
 * `stage` sub-states.
 *
 * The data path (`getRepoData`) reproduces the former remote loader's fetch
 * exactly, so the unified loader stays byte-identical for this source. The one
 * adaptation vs template is env-injection: the GitHub client's API base is now
 * supplied per call, so this source threads its optional {@link EngineEnv}
 * through every fetch it makes.
 */
import {
  STAGING_AREA_REL,
  type Affordance,
  type Resource,
  type ResourceQuery,
} from '@anokye-labs/kbexplorer-core';
import type { KBConfig, SourceConfig } from '@anokye-labs/kbexplorer-core';
import {
  fetchIssues,
  fetchPullRequests,
  fetchTree,
  fetchFile,
  fetchFiles,
  fetchCommits,
  fetchReleases,
  type CacheStore,
} from '../github-client';
import type { GHIssue, GHTreeItem, GHCommit, GHRelease } from '../github-types';
import { loadConfig } from '../parser';
import type { ContentModelSource } from '../content-model';
import { hasExplicitStructuredContentPath, resolveStructuredContentPath } from '../structured-content';
import type { EngineEnv } from '../env';
import type { RepoData, RepoSource, RepoPullRequest } from './repo-data';

export type ResolutionPreset = 'summary' | 'standard' | 'full';

interface FetchedData {
  issues: GHIssue[];
  pullRequests: GHIssue[];
  tree: GHTreeItem[];
  readme: string | null;
  commits: GHCommit[];
  releases: GHRelease[];
  authoredContent: Record<string, string>;
  structuralFiles: Record<string, string>;
  structuredNodeMapRaw: string | null;
  contentModel: ContentModelSource | null;
  config: KBConfig;
  themeFileRaw: string | null;
}

/** Whether a repo path is a `.github` structural artifact or a CODEOWNERS file. */
function isStructuralPath(path: string): boolean {
  return path.startsWith('.github/') || /(^|\/)CODEOWNERS$/.test(path);
}

/** Skip oversized `.github` blobs (mirrors the local manifest cap). */
const MAX_STRUCTURAL_FILE_SIZE = 256 * 1024;

/**
 * Fetch `structured-node-map.yaml`, falling back to `structured-node-map.yml`.
 * Mirrors `readStructuredNodeMap()` in `scripts/generate-manifest.js`, which
 * accepts both extensions for local manifest generation — remote mode must
 * not silently drop a repo's structured node map just because it uses `.yml`.
 */
async function fetchStructuredNodeMap(source: SourceConfig, env?: EngineEnv, cache?: CacheStore): Promise<string | null> {
  for (const name of ['structured-node-map.yaml', 'structured-node-map.yml']) {
    try {
      return await fetchFile(source, name, env, cache);
    } catch {
      // Try the next extension.
    }
  }
  return null;
}

export class GitHubApiSource implements RepoSource {
  readonly id = 'github-api';
  readonly name = 'GitHub API';
  /** Advisory universe; authoritative affordances live on each retrieval. */
  readonly possibleAffordances: Affordance[] = ['read', 'write', 'stage', 'comment', 'close', 'merge'];

  private fetchPromise: Promise<FetchedData> | null = null;

  private readonly source: SourceConfig;
  private readonly preset: ResolutionPreset;
  private readonly env?: EngineEnv | undefined;
  private readonly cache?: CacheStore | undefined;

  constructor(source: SourceConfig, preset: ResolutionPreset = 'standard', env?: EngineEnv, cache?: CacheStore) {
    this.source = source;
    this.preset = preset;
    this.env = env;
    this.cache = cache;
  }

  /** The locator of this repo's staging area (git index). */
  private get stagingHref(): string {
    return `git://${this.source.repo}/.git/index`;
  }

  /** Fetch (memoized) so `resolveConfig` + `getRepoData` share one round-trip. */
  private fetch(): Promise<FetchedData> {
    if (!this.fetchPromise) this.fetchPromise = this.fetchGitHubData();
    return this.fetchPromise;
  }

  /** Resolve the config without re-fetching. */
  async resolveConfig(): Promise<KBConfig> {
    return (await this.fetch()).config;
  }

  async resolveThemeFileRaw(): Promise<string | null> {
    return (await this.fetch()).themeFileRaw;
  }

  async getRepoData(): Promise<RepoData> {
    const data = await this.fetch();
    return {
      repo: this.source.repo,
      tree: data.tree,
      authoredContent: data.authoredContent,
      // No nodemap fetched at runtime yet — AuthoredProvider degrades to a
      // safe no-op over authoredContent alone. (nodemapFiles/nodemapDirs are
      // left unset rather than assigned undefined because this package enables
      // exactOptionalPropertyTypes.)
      nodemapRaw: null,
      listFiles: async () => [],
      issues: data.issues,
      // Reproduce the former remote shaping: no head_branch (so WorkProvider
      // emits no branch connections), user/assignees retained for people.
      // (user/assignees are set conditionally because this package's config
      // enables exactOptionalPropertyTypes — an explicit `undefined` value is
      // not assignable to the optional target fields.)
      pullRequests: data.pullRequests.map(pr => {
        const mapped: RepoPullRequest = {
          number: pr.number,
          title: pr.title,
          body: pr.body ?? '',
          state: pr.state,
          labels: pr.labels.map(l => ({ name: l.name, color: l.color ?? '' })),
          html_url: pr.html_url,
          created_at: pr.created_at,
          updated_at: pr.updated_at,
        };
        if (pr.user) mapped.user = pr.user;
        if (pr.assignees) mapped.assignees = pr.assignees;
        return mapped;
      }),
      commits: data.commits,
      branches: [],
      repoMetadata: null,
      releases: data.releases,
      structuralFiles: data.structuralFiles,
      structuredNodeMapRaw: data.structuredNodeMapRaw,
      contentModel: data.contentModel ?? null,
      readme: data.readme,
      themeFileRaw: data.themeFileRaw,
    };
  }

  // ── Formal resource surface (Git ≠ GitHub, per-retrieval affordances) ─────

  async retrieve(query: ResourceQuery): Promise<Resource[]> {
    const data = await this.fetch();
    const kind = query.kind;
    const worktree = query.worktree === true;
    const staged = query.staged === true;
    const out: Resource[] = [];

    if (kind === 'staging-area') {
      out.push(this.stagingAreaResource());
      return out;
    }

    // ── Git family ──
    if (!kind || kind === 'file' || kind === 'tree') {
      for (const item of data.tree) {
        if (kind === 'file' && item.type !== 'blob') continue;
        if (kind === 'tree' && item.type !== 'tree') continue;
        out.push(this.gitFileResource(item, { worktree, staged }));
      }
    }
    if (!kind || kind === 'commit') {
      for (const c of data.commits) out.push(this.commitResource(c));
    }

    // ── GitHub family ──
    if (!kind || kind === 'issue') {
      for (const issue of data.issues) out.push(this.issueResource(issue));
    }
    if (!kind || kind === 'pull-request') {
      for (const pr of data.pullRequests) out.push(this.pullRequestResource(pr));
    }
    if (!kind || kind === 'release') {
      for (const r of data.releases) out.push(this.releaseResource(r));
    }
    return out;
  }

  async get(href: string): Promise<Resource | undefined> {
    if (href === this.stagingHref) return this.stagingAreaResource();
    const all = await this.retrieve({});
    return all.find(r => r.href === href);
  }

  /**
   * A git file/tree resource. Affordances are situational:
   *  - plain read → `['read']`
   *  - writable worktree → `['read','write','stage']`
   *  - staged → `['read','write','stage']` PLUS a `staging-area` link.
   */
  private gitFileResource(
    item: { path: string; type: 'blob' | 'tree' },
    ctx: { worktree: boolean; staged: boolean },
  ): Resource {
    const href = `git://${this.source.repo}/${item.path}`;
    const affordances: Affordance[] = ctx.worktree || ctx.staged ? ['read', 'write', 'stage'] : ['read'];
    const links = [{ rel: 'self', href }];
    if (ctx.staged) {
      // A staged resource MUST link to its retrievable staging area.
      links.push({ rel: STAGING_AREA_REL, href: this.stagingHref });
    }
    return { href, kind: item.type === 'tree' ? 'tree' : 'file', affordances, links, body: { path: item.path } };
  }

  private stagingAreaResource(): Resource {
    return {
      href: this.stagingHref,
      kind: 'staging-area',
      affordances: ['read', 'stage'],
      links: [{ rel: 'self', href: this.stagingHref }],
      body: { repo: this.source.repo },
    };
  }

  private commitResource(c: GHCommit): Resource {
    const href = `git://${this.source.repo}/commit/${c.sha}`;
    return {
      href,
      kind: 'commit',
      affordances: ['read'],
      links: [{ rel: 'self', href }],
      body: { sha: c.sha, message: c.commit.message },
    };
  }

  private issueResource(issue: GHIssue): Resource {
    const href = `github://${this.source.repo}/issues/${issue.number}`;
    return {
      href,
      kind: 'issue',
      affordances: ['read', 'comment', 'close'],
      links: [{ rel: 'self', href }],
      body: { number: issue.number, title: issue.title, state: issue.state },
    };
  }

  private pullRequestResource(pr: GHIssue): Resource {
    const href = `github://${this.source.repo}/pull/${pr.number}`;
    return {
      href,
      kind: 'pull-request',
      affordances: ['read', 'comment', 'close', 'merge'],
      links: [{ rel: 'self', href }],
      body: { number: pr.number, title: pr.title, state: pr.state },
    };
  }

  private releaseResource(r: GHRelease): Resource {
    const href = `github://${this.source.repo}/releases/${r.tag_name}`;
    return {
      href,
      kind: 'release',
      affordances: ['read'],
      links: [{ rel: 'self', href }],
      body: { tag: r.tag_name },
    };
  }

  // ── Data path (moved verbatim from the former remote loader) ──────────────

  private async fetchGitHubData(): Promise<FetchedData> {
    const source = this.source;
    const preset = this.preset;
    const env = this.env;
    const cache = this.cache;
    const config = await loadConfig(source, env, cache);

    const themeFilePromise = config.theme?.themesFile
      ? fetchFile(source, config.theme.themesFile, env, cache).catch(() => null)
      : Promise.resolve<string | null>(null);

    const [issues, readme, releases, themeFileRaw] = await Promise.all([
      fetchIssues(source, env, cache).catch(() => [] as GHIssue[]),
      fetchFile(source, 'README.md', env, cache).catch(() => null),
      fetchReleases(source, 30, env, cache).catch(() => [] as GHRelease[]),
      themeFilePromise,
    ]);

    let tree: GHTreeItem[] = [];
    let pullRequests: GHIssue[] = [];
    let commits: GHCommit[] = [];
    const authoredContent: Record<string, string> = {};
    const structuralFiles: Record<string, string> = {};
    let structuredNodeMapRaw: string | null = null;
    let contentModel: ContentModelSource | null = null;

    if (preset === 'standard' || preset === 'full') {
      const [treeResult, prResult] = await Promise.all([
        fetchTree(source, undefined, env, cache).catch(() => [] as GHTreeItem[]),
        fetchPullRequests(source, env, cache).catch(() => [] as GHIssue[]),
      ]);
      tree = treeResult;
      pullRequests = prResult;

      if (config.source.path) {
        try {
          const contentTree = await fetchTree(source, config.source.path, env, cache);
          const mdFiles = contentTree
            .filter(item => item.type === 'blob' && item.path.endsWith('.md'))
            .map(item => item.path);
          const files = await fetchFiles(source, mdFiles, env, cache);
          for (const [path, content] of files) {
            authoredContent[path] = content;
          }
        } catch {
          // Content directory may not exist
        }
      }

      contentModel = await this.fetchContentModel(config);

      try {
        const structuralPaths = tree
          .filter(item =>
            item.type === 'blob' &&
            isStructuralPath(item.path) &&
            !(typeof item.size === 'number' && item.size > MAX_STRUCTURAL_FILE_SIZE),
          )
          .map(item => item.path);
        if (structuralPaths.length > 0) {
          const files = await fetchFiles(source, structuralPaths, env, cache);
          for (const [path, content] of files) {
            if (content.length > MAX_STRUCTURAL_FILE_SIZE) continue;
            structuralFiles[path] = content;
          }
        }
        structuredNodeMapRaw = await fetchStructuredNodeMap(source, env, cache);
      } catch {
        // `.github` may not exist — safe no-op.
      }
    }

    if (preset === 'full') {
      commits = await fetchCommits(source, 30, env, cache).catch(() => [] as GHCommit[]);
    }

    return { issues, pullRequests, tree, readme, commits, releases, authoredContent, structuralFiles, structuredNodeMapRaw, contentModel, config, themeFileRaw: themeFileRaw ?? null };
  }

  private async fetchContentModel(config: KBConfig): Promise<ContentModelSource | null> {
    const env = this.env;
    const cache = this.cache;
    const root = resolveStructuredContentPath(config, env);
    const explicitPath = hasExplicitStructuredContentPath(config, env);
    try {
      const contentModelTree = await fetchTree(this.source, root, env, cache);
      const paths = contentModelTree
        .filter(item => item.type === 'blob')
        .map(item => item.path)
        .filter(path => !path.slice(root.length + 1).split('/').some(segment => segment.startsWith('.')));
      if (paths.length === 0) {
        if (explicitPath) {
          console.warn(`[github-api-source] No structured content files found at configured path ${root}`);
        }
        return null;
      }

      const files = await fetchFiles(this.source, paths, env, cache);
      const sourceFiles: Record<string, string> = {};
      for (const [path, content] of files) {
        const relativePath = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
        sourceFiles[relativePath] = content;
      }

      if (Object.keys(sourceFiles).length === 0) {
        if (explicitPath) {
          console.warn(`[github-api-source] Structured content path ${root} was listed but no files could be fetched`);
        }
        return null;
      }

      return { root, files: sourceFiles };
    } catch (error) {
      console.warn(`[github-api-source] Failed to fetch structured content from ${root}:`, error);
      return null;
    }
  }
}
