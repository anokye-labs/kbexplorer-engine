/**
 * ManifestSource (Phase 4 / F4 #320; moved in
 * anokye-labs/kbexplorer-template#472, slice 4/5).
 *
 * A read-only {@link RepoSource} backed by a pre-built `repo-manifest.json`.
 * Every resource it retrieves carries exactly `['read']` — a manifest is a
 * frozen snapshot, so nothing can be written or staged through it. There is no
 * staging area (and therefore no `staging-area` link): staging is a Git/GitHub
 * concern, absent from a static manifest.
 */
import type { Affordance, Resource, ResourceQuery } from '@anokye-labs/kbexplorer-core';
import type { KBConfig } from '@anokye-labs/kbexplorer-core';
import type { GHTreeItem } from '../github-types';
import { globToRegex } from '../glob';
import type { RepoManifest } from './repo-manifest';
import type { RepoData, RepoSource } from './repo-data';

export class ManifestSource implements RepoSource {
  readonly id = 'manifest';
  readonly name = 'Repo Manifest';
  /** A manifest is a frozen snapshot — read is the only possible affordance. */
  readonly possibleAffordances: Affordance[] = ['read'];

  private readonly manifest: RepoManifest;
  private readonly config: KBConfig;

  constructor(manifest: RepoManifest, config: KBConfig) {
    this.manifest = manifest;
    this.config = config;
  }

  async getRepoData(): Promise<RepoData> {
    const manifest = this.manifest;
    const listFiles = async (pattern: string): Promise<string[]> => {
      const regex = globToRegex(pattern);
      return Object.keys(manifest.nodemapFiles ?? {}).filter(p => regex.test(p));
    };

    const data: RepoData = {
      repo: this.config.source.repo,
      tree: manifest.tree as GHTreeItem[],
      authoredContent: manifest.authoredContent,
      nodemapRaw: manifest.nodemapRaw ?? null,
      listFiles,
      issues: manifest.issues,
      pullRequests: manifest.pullRequests,
      commits: manifest.commits,
      branches: manifest.branches ?? [],
      repoMetadata: manifest.repoMetadata ?? null,
      releases: manifest.releases ?? [],
      structuralFiles: manifest.structuralFiles ?? {},
      structuredNodeMapRaw: manifest.structuredNodeMapRaw ?? null,
      contentModel: manifest.contentModel ?? null,
      readme: manifest.readme,
      themeFileRaw: manifest.themeFileRaw ?? null,
    };
    // Set optional map fields only when present — this package enables
    // exactOptionalPropertyTypes, which rejects an explicit `undefined` value
    // for these optional targets.
    if (manifest.nodemapFiles !== undefined) data.nodemapFiles = manifest.nodemapFiles;
    if (manifest.nodemapDirs !== undefined) {
      data.nodemapDirs = manifest.nodemapDirs as Record<string, GHTreeItem[]>;
    }
    return data;
  }

  /**
   * Read-only resource surface. Files (tree blobs/trees) and issues are
   * retrievable; every resource is afforded `['read']` and links only to
   * itself. No write/stage, no staging area.
   */
  async retrieve(query: ResourceQuery): Promise<Resource[]> {
    const kind = query.kind;
    const out: Resource[] = [];

    if (!kind || kind === 'file' || kind === 'tree') {
      for (const item of this.manifest.tree) {
        if (kind === 'file' && item.type !== 'blob') continue;
        if (kind === 'tree' && item.type !== 'tree') continue;
        out.push(this.fileResource(item));
      }
    }
    if (!kind || kind === 'issue') {
      for (const issue of this.manifest.issues) {
        out.push(this.issueResource(issue.number, issue.title));
      }
    }
    return out;
  }

  async get(href: string): Promise<Resource | undefined> {
    const all = await this.retrieve({});
    return all.find(r => r.href === href);
  }

  private fileResource(item: { path: string; type: 'blob' | 'tree' }): Resource {
    return {
      href: `git://${this.config.source.repo}/${item.path}`,
      kind: item.type === 'tree' ? 'tree' : 'file',
      affordances: ['read'],
      links: [{ rel: 'self', href: `git://${this.config.source.repo}/${item.path}` }],
      body: { path: item.path },
    };
  }

  private issueResource(number: number, title: string): Resource {
    return {
      href: `github://${this.config.source.repo}/issues/${number}`,
      kind: 'issue',
      affordances: ['read'],
      links: [{ rel: 'self', href: `github://${this.config.source.repo}/issues/${number}` }],
      body: { number, title },
    };
  }
}
