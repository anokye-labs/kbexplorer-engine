/**
 * nodemap.yaml parser — reads a nodemap definition and produces KBNode[].
 *
 * The nodemap defines how repository files, directories, and globs map
 * to knowledge-graph nodes.  This module is standalone: callers provide
 * I/O callbacks so it works with both GitHub API and local filesystem.
 */

import { marked } from 'marked';
import yaml from 'yaml';
import type {
  NodeMapEntry,
  NodeMap,
  KBNode,
  Connection,
  DisplayMode,
  NodeSource,
} from '../types';
import { splitIntoSections } from './parser';

// ── Helpers ────────────────────────────────────────────────

function basename(filePath: string): string {
  const name = filePath.split('/').pop() ?? filePath;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.substring(0, dot) : name;
}

function extname(filePath: string): string {
  const name = filePath.split('/').pop() ?? filePath;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.substring(dot) : '';
}

function isMarkdown(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === '.md' || ext === '.mdx';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderHtml(content: string, filePath: string): string {
  if (isMarkdown(filePath)) {
    return marked.parse(content, { async: false }) as string;
  }
  return `<pre><code>${escapeHtml(content)}</code></pre>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getNodePath(node: KBNode): string | undefined {
  if (node.source.type === 'file') return node.source.path;
  if (node.source.type === 'authored') return node.source.file;
  return undefined;
}

/** Convert a simple glob pattern to a RegExp for exclude matching. */
function globToRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i += 1;
      if (pattern[i + 1] === '/') i += 1;
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some(p => globToRegex(p).test(path));
}

// ── Node builder ───────────────────────────────────────────

function buildFileNode(
  id: string,
  title: string,
  filePath: string,
  content: string,
  entry: NodeMapEntry,
): KBNode {
  const isMd = isMarkdown(filePath);
  const display: DisplayMode | undefined =
    entry.display ?? (isMd ? undefined : 'code');
  const source: NodeSource = isMd
    ? { type: 'authored', file: filePath }
    : { type: 'file', path: filePath };

  return {
    id,
    title,
    cluster: entry.cluster ?? 'default',
    content: renderHtml(content, filePath),
    rawContent: content,
    emoji: entry.emoji,
    display,
    derived: true,
    connections: [],
    identity: `urn:file:${filePath}`,
    source,
  };
}

// ── Processing modes ───────────────────────────────────────

/** Mode 1 & 2: single file, optionally split at ## headings. */
async function processSingleFile(
  entry: NodeMapEntry,
  readFile: (path: string) => Promise<string | null>,
): Promise<KBNode[]> {
  const filePath = entry.file!;
  const content = await readFile(filePath);
  if (content === null) return [];

  const id = entry.id;
  const title = entry.title ?? basename(filePath);

  if (entry.split === 'headings') {
    const isMd = isMarkdown(filePath);
    const source: NodeSource = isMd
      ? { type: 'authored', file: filePath }
      : { type: 'file', path: filePath };

    const sections = splitIntoSections(
      id,
      title,
      content,
      entry.cluster ?? 'default',
      entry.emoji ?? 'Document',
      source,
      [], // cross-ref nodes added in the connection-derivation pass
    );

    if (sections.length > 0) {
      if (entry.display) {
        const parent = sections.find(n => n.nodeType === 'parent');
        if (parent) parent.display = entry.display;
      }
      return sections;
    }
    // Fewer than 2 headings — fall through to single-node output
  }

  return [buildFileNode(id, title, filePath, content, entry)];
}

/** Mode 3: merge multiple files into one node. */
async function processMerge(
  entry: NodeMapEntry,
  readFile: (path: string) => Promise<string | null>,
): Promise<KBNode[]> {
  const files = entry.files!;
  const parts: string[] = [];

  for (const filePath of files) {
    const content = await readFile(filePath);
    if (content === null) continue;
    const name = filePath.split('/').pop() ?? filePath;
    parts.push(`## ${name}\n\n${content}`);
  }

  if (parts.length === 0) return [];

  const merged = parts.join('\n\n---\n\n');
  const html = marked.parse(merged, { async: false }) as string;
  const display: DisplayMode = entry.display ?? 'file-list';

  return [
    {
      id: entry.id,
      title: entry.title ?? entry.id,
      cluster: entry.cluster ?? 'default',
      content: html,
      rawContent: merged,
      emoji: entry.emoji,
      display,
      derived: true,
      connections: [],
      source: { type: 'file', path: files[0] },
    },
  ];
}

/** Mode 4: glob pattern → one node per matching file. */
async function processGlob(
  entry: NodeMapEntry,
  readFile: (path: string) => Promise<string | null>,
  listFiles?: (pattern: string) => Promise<string[]>,
): Promise<KBNode[]> {
  if (!listFiles) return [];

  let paths = await listFiles(entry.glob!);

  if (entry.exclude?.length) {
    paths = paths.filter(p => !matchesAnyGlob(p, entry.exclude!));
  }

  const nodes: KBNode[] = [];
  for (const filePath of paths) {
    const content = await readFile(filePath);
    if (content === null) continue;

    const fileBase = basename(filePath);
    const nodeId = `${entry.id}-${fileBase}`;

    let title: string;
    if (entry.titleFrom === 'heading') {
      const m = content.match(/^#\s+(.+)/m);
      title = m ? m[1].trim() : fileBase;
    } else {
      title = fileBase;
    }

    nodes.push(buildFileNode(nodeId, title, filePath, content, entry));
  }

  return nodes;
}

/** Mode 5: directory listing → one tree node. */
async function processDirectory(
  entry: NodeMapEntry,
  listDirectory?: (
    dir: string,
  ) => Promise<{ path: string; type: 'blob' | 'tree'; size?: number }[]>,
): Promise<KBNode[]> {
  if (!listDirectory) return [];

  const dir = entry.directory!;
  const items = await listDirectory(dir);

  const lines = items.map(item => {
    const icon = item.type === 'tree' ? '📁' : '📄';
    const name = item.path.split('/').pop() ?? item.path;
    const size = item.size != null ? ` (${formatBytes(item.size)})` : '';
    return `${icon} ${name}${size}`;
  });

  const title = entry.title ?? dir;
  const rawContent = `## ${title}\n\n${lines.join('\n')}`;
  const html = marked.parse(rawContent, { async: false }) as string;

  return [
    {
      id: entry.id,
      title,
      cluster: entry.cluster ?? 'default',
      content: html,
      rawContent,
      emoji: entry.emoji ?? 'Folder',
      display: entry.display ?? 'tree',
      derived: true,
      connections: [],
      source: { type: 'file', path: dir },
    },
  ];
}

// ── Connection derivation ──────────────────────────────────

/** Resolve a relative import path against the importing file's location. */
export function resolveImportPath(
  importPath: string,
  fromFile: string,
): string {
  const lastSlash = fromFile.lastIndexOf('/');
  const fromDir = lastSlash >= 0 ? fromFile.substring(0, lastSlash) : '';
  const combined = fromDir ? `${fromDir}/${importPath}` : importPath;
  const parts = combined.split('/');
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (resolved.length) resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  return resolved.join('/');
}

/** Extract relative import/require paths from source code. */
export function extractImportPaths(
  content: string,
  fromFile: string,
): string[] {
  const paths: string[] = [];

  // import ... from '...' (handles multiline destructured imports)
  for (const m of content.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    if (m[1].startsWith('.'))
      paths.push(resolveImportPath(m[1], fromFile));
  }

  // Side-effect imports: import '...'
  for (const m of content.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    if (m[1].startsWith('.'))
      paths.push(resolveImportPath(m[1], fromFile));
  }

  // CommonJS require('...')
  for (const m of content.matchAll(
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    if (m[1].startsWith('.'))
      paths.push(resolveImportPath(m[1], fromFile));
  }

  return [...new Set(paths)];
}

/** Look up a resolved import path in the path→nodeId map, trying common extensions. */
function findNodeIdByPath(
  resolved: string,
  pathToId: Map<string, string>,
): string | undefined {
  if (pathToId.has(resolved)) return pathToId.get(resolved);
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs']) {
    if (pathToId.has(resolved + ext)) return pathToId.get(resolved + ext);
  }
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    if (pathToId.has(`${resolved}/index${ext}`))
      return pathToId.get(`${resolved}/index${ext}`);
  }
  return undefined;
}

/** Second pass: add connections to nodes based on each entry's `connections` spec. */
function deriveConnections(
  allNodes: KBNode[],
  entries: NodeMapEntry[],
  entryNodeIds: Map<string, string[]>,
): void {
  const pathToId = new Map<string, string>();
  const nodeById = new Map<string, KBNode>();
  for (const node of allNodes) {
    nodeById.set(node.id, node);
    const p = getNodePath(node);
    if (p) {
      // Prefer authored nodes over file nodes for the same path
      const existing = pathToId.get(p);
      if (!existing || node.source.type === 'authored') {
        pathToId.set(p, node.id);
      }
    }
  }

  for (const entry of entries) {
    if (!entry.connections) continue;
    const nodeIds = entryNodeIds.get(entry.id) ?? [];

    // Explicit Connection[] — attach directly
    if (Array.isArray(entry.connections)) {
      for (const nodeId of nodeIds) {
        const node = nodeById.get(nodeId);
        if (node) node.connections.push(...entry.connections);
      }
      continue;
    }

    // 'imports' — scan for import/require statements
    if (entry.connections === 'imports') {
      for (const nodeId of nodeIds) {
        const node = nodeById.get(nodeId);
        if (!node) continue;
        const fromPath = getNodePath(node);
        if (!fromPath) continue;

        const imports = extractImportPaths(node.rawContent, fromPath);
        for (const imp of imports) {
          const targetId = findNodeIdByPath(imp, pathToId);
          if (targetId && targetId !== nodeId) {
            node.connections.push({
              to: targetId,
              type: 'references',
              description: `Imports ${imp.split('/').pop() ?? imp}`,
              source: 'inferred',
            });
          }
        }
      }
      continue;
    }

    // 'references' — scan for mentions of other node titles/IDs
    if (entry.connections === 'references') {
      for (const nodeId of nodeIds) {
        const node = nodeById.get(nodeId);
        if (!node) continue;
        const lower = node.rawContent.toLowerCase();
        const seen = new Set(node.connections.map(c => c.to));

        for (const other of allNodes) {
          if (other.id === nodeId || seen.has(other.id)) continue;

          // Exact ID mention
          if (lower.includes(other.id.toLowerCase())) {
            node.connections.push({
              to: other.id,
              type: 'mentions',
              description: `Mentions ${other.title}`,
              source: 'inferred',
            });
            seen.add(other.id);
            continue;
          }

          // Title-word overlap (same heuristic as parser.ts)
          const words = other.title
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 3);
          if (words.length === 0) continue;
          const hits = words.filter(w => lower.includes(w)).length;
          if (hits >= Math.ceil(words.length * 0.6)) {
            node.connections.push({
              to: other.id,
              type: 'mentions',
              description: `Mentions ${other.title}`,
              source: 'inferred',
            });
            seen.add(other.id);
          }
        }
      }
    }
  }
}

// ── Public API ──────────────────────────────────────────────

/**
 * Load and process a nodemap.yaml file.
 * Returns KBNode[] for all mapped entries.
 */
export async function loadNodeMap(
  nodemapRaw: string,
  readFile: (path: string) => Promise<string | null>,
  listFiles?: (pattern: string) => Promise<string[]>,
  listDirectory?: (
    dir: string,
  ) => Promise<{ path: string; type: 'blob' | 'tree'; size?: number }[]>,
): Promise<KBNode[]> {
  const map = yaml.parse(nodemapRaw) as NodeMap;
  if (!map?.nodes?.length) return [];

  const allNodes: KBNode[] = [];
  const entryNodeIds = new Map<string, string[]>();

  for (const entry of map.nodes) {
    let nodes: KBNode[] = [];

    if (entry.file) {
      nodes = await processSingleFile(entry, readFile);
    } else if (entry.files) {
      nodes = await processMerge(entry, readFile);
    } else if (entry.glob && entry.each === 'file') {
      nodes = await processGlob(entry, readFile, listFiles);
    } else if (entry.directory) {
      nodes = await processDirectory(entry, listDirectory);
    }

    entryNodeIds.set(entry.id, nodes.map(n => n.id));
    allNodes.push(...nodes);
  }

  deriveConnections(allNodes, map.nodes, entryNodeIds);

  return allNodes;
}
