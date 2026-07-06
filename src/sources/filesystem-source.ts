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
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, basename, sep } from 'node:path';
import yaml from 'yaml';
import type { Affordance, Resource, ResourceQuery } from '@anokye-labs/kbexplorer-core';
import type { GHTreeItem } from '../github-types';
import type { ContentModelSource } from '../content-model';
import { globToRegex } from '../glob';
import { collectNodemapData } from '../nodemap';
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
   * content nodes. Defaults to `'content'`. Pass `''` (or `'.'`) to treat
   * **top-level** `.md` files in the root itself as authored content (the
   * legacy root-scan convention) — `README.md` still stays the repo readme.
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
  /**
   * Whether the walked file tree is exposed as `RepoData.tree` (which the
   * unified loader turns into structural file/dir/repo-root nodes via
   * `FilesProvider`). Defaults to `true` (byte-identical to prior behavior).
   * Set `false` for a **content-only** graph — authored content + provider
   * entities, with none of the file-tree scaffolding nodes. `listFiles` and
   * authored-content ingestion are unaffected; only the emitted `tree` (and the
   * `retrieve`/`get` resource surface derived from it) is suppressed.
   */
  includeFileTree?: boolean;
}

/**
 * Directories never walked, regardless of the `ignore` option. `.git` is also
 * covered by the dotfile-skip rule below (kept explicit here for clarity and
 * for any future dotfile exception).
 */
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
  private readonly includeFileTree: boolean;

  private cache: Promise<RepoData> | null = null;

  constructor(rootDir: string, options: FileSystemSourceOptions = {}) {
    this.rootDir = resolve(rootDir);
    this.repo = options.repo ?? basename(this.rootDir);
    this.contentPath = options.contentPath ?? 'content';
    this.contentModelPath = options.contentModelPath ?? 'content-model';
    this.ignore = new Set([...ALWAYS_IGNORE, ...(options.ignore ?? [])]);
    this.includeFileTree = options.includeFileTree ?? true;
  }

  async getRepoData(): Promise<RepoData> {
    if (!this.cache) this.cache = this.readRepoData();
    return this.cache;
  }

  private async readRepoData(): Promise<RepoData> {
    const files = await this.walk();
    const paths = files.map(f => f.path);

    const tree: GHTreeItem[] = this.includeFileTree
      ? files.map(f => ({ path: f.path, type: f.type }))
      : [];

    const authoredContent: Record<string, string> = {};
    const structuralFiles: Record<string, string> = {};
    // Root-scan mode (`contentPath` of '' or '.'): top-level `.md` files in the
    // root are authored content. Otherwise authored content lives under
    // `${contentPath}/`.
    const rootScan = this.contentPath === '' || this.contentPath === '.';
    const contentPrefix = rootScan ? '' : `${this.contentPath}/`;
    const contentModelPrefix = `${this.contentModelPath}/`;
    const contentModelFiles: Record<string, string> = {};
    let readme: string | null = null;
    let structuredNodeMapRaw: string | null = null;

    for (const file of files) {
      if (file.type !== 'blob') continue;

      const isAuthoredMd =
        file.path.endsWith('.md') &&
        file.path !== 'README.md' &&
        (rootScan ? !file.path.includes('/') : file.path.startsWith(contentPrefix));
      if (isAuthoredMd) {
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

    const nodemapRaw = await this.readNodemapRaw();
    let nodemapFiles: Record<string, string> | undefined;
    let nodemapDirs: Record<string, GHTreeItem[]> | undefined;
    if (nodemapRaw !== null) {
      // Nodemap glob/directory expansion always walks the full local tree
      // (`files`), independent of `includeFileTree` (which only controls
      // whether `RepoData.tree` itself is exposed to the loader).
      const collected = await collectNodemapData(
        nodemapRaw,
        files,
        path => this.readSafe(path),
        dir => this.listNodemapDir(dir),
      );
      nodemapFiles = collected.nodemapFiles;
      nodemapDirs = collected.nodemapDirs;
    }

    const themeFileRaw = await this.resolveThemeFileRaw();

    return {
      repo: this.repo,
      tree,
      authoredContent,
      nodemapRaw,
      ...(nodemapFiles !== undefined ? { nodemapFiles } : {}),
      ...(nodemapDirs !== undefined ? { nodemapDirs } : {}),
      listFiles,
      issues: [],
      pullRequests: [],
      commits: [],
      // Legitimately empty/null in local mode — there is no live GitHub to
      // fetch branches/repo metadata from (anokye-labs/kbexplorer-engine#23).
      branches: [],
      repoMetadata: null,
      releases: [],
      structuralFiles,
      structuredNodeMapRaw,
      contentModel,
      readme,
      themeFileRaw,
    };
  }

  /** Read one repo-relative file as UTF-8. */
  private read(repoRelative: string): Promise<string> {
    return readFile(join(this.rootDir, repoRelative), 'utf8');
  }

  /** Read one repo-relative file as UTF-8, returning `null` when missing/unreadable. */
  private async readSafe(repoRelative: string): Promise<string | null> {
    try {
      return await readFile(join(this.rootDir, repoRelative), 'utf8');
    } catch {
      return null;
    }
  }

  /** Read `nodemap.yaml`/`nodemap.yml` from the repo root, or `null` if neither exists. */
  private async readNodemapRaw(): Promise<string | null> {
    for (const name of ['nodemap.yaml', 'nodemap.yml']) {
      const content = await this.readSafe(name);
      if (content !== null) return content;
    }
    return null;
  }

  /** Read `${contentPath}/config.yaml`(`.yml`), falling back to a root-level `config.yaml`. */
  private async readConfigRaw(): Promise<string | null> {
    const rootScan = this.contentPath === '' || this.contentPath === '.';
    const contentPrefix = rootScan ? '' : `${this.contentPath}/`;
    const candidates = [`${contentPrefix}config.yaml`, `${contentPrefix}config.yml`, 'config.yaml'];
    for (const candidate of candidates) {
      const content = await this.readSafe(candidate);
      if (content !== null) return content;
    }
    return null;
  }

  /**
   * Read the raw contents of the dedicated theme file referenced by
   * `config.theme.themesFile`, mirroring the old generator's `readThemeFile`.
   * `null` when no `themesFile` is configured, the config can't be parsed, the
   * path escapes the repo root, or the file is missing — a safe no-op.
   */
  private async resolveThemeFileRaw(): Promise<string | null> {
    const configRaw = await this.readConfigRaw();
    if (!configRaw) return null;

    let parsed: unknown;
    try {
      parsed = yaml.parse(configRaw);
    } catch {
      return null;
    }

    const themesFile = (parsed as { theme?: { themesFile?: unknown } } | null)?.theme?.themesFile;
    if (!themesFile || typeof themesFile !== 'string') return null;
    // Security: only allow repo-root-relative paths that stay inside the repo.
    if (isAbsolute(themesFile)) return null;
    const abs = resolve(this.rootDir, themesFile);
    const rel = relative(this.rootDir, abs);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;

    try {
      return await readFile(abs, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * One-level directory listing (with file sizes) for a nodemap `directory:`
   * entry — distinct from `walk()`, which is recursive and does not stat
   * files. Mirrors the old generator's `listDir`.
   */
  private async listNodemapDir(dirPath: string): Promise<GHTreeItem[]> {
    const abs = join(this.rootDir, dirPath);
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return [];
    }

    const out: GHTreeItem[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out.push({ path: entryPath, type: 'tree' });
      } else if (entry.isFile()) {
        try {
          const st = await stat(join(abs, entry.name));
          out.push({ path: entryPath, type: 'blob', size: st.size });
        } catch {
          out.push({ path: entryPath, type: 'blob' });
        }
      }
    }
    return out;
  }

  /** Convert an absolute path under the root into a POSIX repo-relative path. */
  private toRepoRelative(absolutePath: string): string {
    return absolutePath.slice(this.rootDir.length + 1).split(sep).join('/');
  }

  /**
   * Recursively enumerate the root directory into blob/tree entries with
   * POSIX-separated, repo-relative paths (sorted for determinism). Skips
   * dotfiles/dot-directories (except `.github`, which the StructuralProvider
   * reads) in addition to the always-ignored directories — mirrors the old
   * generator's `walkFileSystem` (anokye-labs/kbexplorer-engine#23).
   */
  private async walk(): Promise<Array<{ path: string; type: 'blob' | 'tree'; size?: number }>> {
    const out: Array<{ path: string; type: 'blob' | 'tree'; size?: number }> = [];
    const stack: string[] = [this.rootDir];

    while (stack.length > 0) {
      const dir = stack.pop()!;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
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
