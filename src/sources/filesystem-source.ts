/**
 * FileSystemSource (anokye-labs/kbexplorer-template#475).
 *
 * A read-only, **Node-only** {@link RepoSource} backed by a directory on disk.
 * It walks a root directory and produces the same normalized {@link RepoData}
 * bundle {@link ManifestSource} yields from a pre-built manifest, so the unified
 * loader can build a graph from local files with no GitHub round-trip and no
 * manifest-generation step. Every resource it retrieves carries exactly
 * `['read']` — a local checkout read through this source is a frozen snapshot;
 * writing/staging is a Git concern that lives on other sources.
 *
 * Runtime note: this file imports `node:fs/promises` and `node:path`, so it is
 * the one source that is Node-specific. It is exposed only from the `./sources`
 * subpath (never the core `.` entry) and holds no browser/DOM or build-time env
 * coupling, keeping it inside the package's two-way boundary contract.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, basename, sep } from 'node:path';
import type { Affordance, Resource, ResourceQuery } from '@anokye-labs/kbexplorer-core';
import type { GHTreeItem } from '../github-types';
import type { ContentModelSource } from '../content-model';
import { globToRegex } from '../glob';
import type { RepoData, RepoSource } from './repo-data';

/** Options controlling how a {@link FileSystemSource} interprets a directory. */
export interface FileSystemSourceOptions {
  /**
   * `owner/name` slug used for file-node identity. Defaults to the root
   * directory's base name (with no owner segment).
   */
  repo?: string;
  /**
   * Sub-directory (relative to the root) whose `.md` files become authored
   * content nodes. Defaults to `'content'`.
   */
  contentPath?: string;
  /**
   * Sub-directory (relative to the root) holding structured content-model
   * files. Defaults to `'content-model'`.
   */
  contentModelPath?: string;
  /**
   * Directory names to skip while walking (in addition to the always-skipped
   * `.git`, `node_modules`, and `dist`).
   */
  ignore?: string[];
}

/** Directories never walked, regardless of the `ignore` option. */
const ALWAYS_IGNORE = new Set(['.git', 'node_modules', 'dist']);

/** Skip `.github` blobs larger than this (mirrors the manifest/API caps). */
const MAX_STRUCTURAL_FILE_SIZE = 256 * 1024;

/** Whether a repo-relative path is a `.github` structural artifact or CODEOWNERS. */
function isStructuralPath(path: string): boolean {
  return path.startsWith('.github/') || /(^|\/)CODEOWNERS$/.test(path);
}

export class FileSystemSource implements RepoSource {
  readonly id = 'filesystem';
  readonly name = 'File System';
  /** A local snapshot read — read is the only possible affordance. */
  readonly possibleAffordances: Affordance[] = ['read'];

  private readonly rootDir: string;
  private readonly repo: string;
  private readonly contentPath: string;
  private readonly contentModelPath: string;
  private readonly ignore: Set<string>;

  private cache: Promise<RepoData> | null = null;

  constructor(rootDir: string, options: FileSystemSourceOptions = {}) {
    this.rootDir = resolve(rootDir);
    this.repo = options.repo ?? basename(this.rootDir);
    this.contentPath = options.contentPath ?? 'content';
    this.contentModelPath = options.contentModelPath ?? 'content-model';
    this.ignore = new Set([...ALWAYS_IGNORE, ...(options.ignore ?? [])]);
  }

  async getRepoData(): Promise<RepoData> {
    if (!this.cache) this.cache = this.readRepoData();
    return this.cache;
  }

  private async readRepoData(): Promise<RepoData> {
    const files = await this.walk();
    const paths = files.map(f => f.path);

    const tree: GHTreeItem[] = files.map(f => ({ path: f.path, type: f.type }));

    const authoredContent: Record<string, string> = {};
    const structuralFiles: Record<string, string> = {};
    const contentPrefix = `${this.contentPath}/`;
    const contentModelPrefix = `${this.contentModelPath}/`;
    const contentModelFiles: Record<string, string> = {};
    let readme: string | null = null;
    let structuredNodeMapRaw: string | null = null;

    for (const file of files) {
      if (file.type !== 'blob') continue;

      if (file.path.startsWith(contentPrefix) && file.path.endsWith('.md')) {
        authoredContent[file.path] = await this.read(file.path);
        continue;
      }

      if (isStructuralPath(file.path) && (file.size ?? 0) <= MAX_STRUCTURAL_FILE_SIZE) {
        const content = await this.read(file.path);
        if (content.length <= MAX_STRUCTURAL_FILE_SIZE) structuralFiles[file.path] = content;
        continue;
      }

      if (file.path.startsWith(contentModelPrefix)) {
        const relativePath = file.path.slice(contentModelPrefix.length);
        contentModelFiles[relativePath] = await this.read(file.path);
        continue;
      }

      if (file.path === 'README.md') {
        readme = await this.read(file.path);
        continue;
      }

      if (structuredNodeMapRaw === null &&
        (file.path === 'structured-node-map.yaml' || file.path === 'structured-node-map.yml')) {
        structuredNodeMapRaw = await this.read(file.path);
      }
    }

    const contentModel: ContentModelSource | null =
      Object.keys(contentModelFiles).length > 0
        ? { root: this.contentModelPath, files: contentModelFiles }
        : null;

    const listFiles = async (pattern: string): Promise<string[]> => {
      const regex = globToRegex(pattern);
      return paths.filter(p => regex.test(p));
    };

    return {
      repo: this.repo,
      tree,
      authoredContent,
      nodemapRaw: null,
      listFiles,
      issues: [],
      pullRequests: [],
      commits: [],
      branches: [],
      repoMetadata: null,
      releases: [],
      structuralFiles,
      structuredNodeMapRaw,
      contentModel,
      readme,
      themeFileRaw: null,
    };
  }

  /** Read one repo-relative file as UTF-8. */
  private read(repoRelative: string): Promise<string> {
    return readFile(join(this.rootDir, repoRelative), 'utf8');
  }

  /** Convert an absolute path under the root into a POSIX repo-relative path. */
  private toRepoRelative(absolutePath: string): string {
    return absolutePath.slice(this.rootDir.length + 1).split(sep).join('/');
  }

  /**
   * Recursively enumerate the root directory into blob/tree entries with
   * POSIX-separated, repo-relative paths (sorted for determinism).
   */
  private async walk(): Promise<Array<{ path: string; type: 'blob' | 'tree'; size?: number }>> {
    const out: Array<{ path: string; type: 'blob' | 'tree'; size?: number }> = [];
    const stack: string[] = [this.rootDir];

    while (stack.length > 0) {
      const dir = stack.pop()!;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && this.ignore.has(entry.name)) continue;
        const absolutePath = join(dir, entry.name);
        const repoRelative = this.toRepoRelative(absolutePath);
        if (entry.isDirectory()) {
          out.push({ path: repoRelative, type: 'tree' });
          stack.push(absolutePath);
        } else if (entry.isFile()) {
          out.push({ path: repoRelative, type: 'blob' });
        }
      }
    }

    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }

  // ── Read-only resource surface (mirrors ManifestSource) ───────────────────

  async retrieve(query: ResourceQuery): Promise<Resource[]> {
    const kind = query.kind;
    const out: Resource[] = [];
    if (!kind || kind === 'file' || kind === 'tree') {
      const { tree } = await this.getRepoData();
      for (const item of tree) {
        if (kind === 'file' && item.type !== 'blob') continue;
        if (kind === 'tree' && item.type !== 'tree') continue;
        out.push(this.fileResource(item));
      }
    }
    return out;
  }

  async get(href: string): Promise<Resource | undefined> {
    const all = await this.retrieve({});
    return all.find(r => r.href === href);
  }

  private fileResource(item: { path: string; type: 'blob' | 'tree' }): Resource {
    const href = `file://${this.repo}/${item.path}`;
    return {
      href,
      kind: item.type === 'tree' ? 'tree' : 'file',
      affordances: ['read'],
      links: [{ rel: 'self', href }],
      body: { path: item.path },
    };
  }
}
