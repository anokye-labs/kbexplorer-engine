/**
 * Content parser: transforms raw GitHub data into KBNode[] for the graph engine.
 *
 * Two modes:
 *   - authored: parses markdown files with YAML frontmatter
 *   - repo-aware: maps GitHub issues, PRs, README, and file tree to nodes
 */
import { marked } from 'marked';
import yaml from 'yaml';
import type {
  KBNode,
  KBConfig,
  Cluster,
  Connection,
  SourceConfig,
} from '../types';
import { DEFAULT_CONFIG } from '../types';
import { assignIdentity } from './identity';
import {
  fetchFile,
  fetchTree,
  fetchFiles,
  fetchIssues,
  type GHIssue,
  type GHTreeItem,
} from '../api';

// ── Authored mode ──────────────────────────────────────────

interface AuthoredFrontmatter {
  id: string;
  title: string;
  emoji?: string;
  cluster: string;
  image?: string;
  sprite?: string;
  parent?: string;
  derived?: boolean;
  display?: import('../types').DisplayMode;
  connections?: Array<{ to: string; description: string }>;
}

/** Parse YAML frontmatter from a markdown string (no Buffer dependency). */
function parseFrontmatter(raw: string): { data: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  try {
    const data = yaml.parse(match[1]) as Record<string, unknown>;
    return { data: data ?? {}, content: match[2] };
  } catch {
    return { data: {}, content: raw };
  }
}

export function parseMarkdownFile(path: string, raw: string): KBNode {
  const { data, content } = parseFrontmatter(raw);
  const fm = data as Partial<AuthoredFrontmatter>;

  const id = fm.id ?? path.replace(/\.md$/, '').replace(/.*\//, '');
  const html = marked.parse(content, { async: false }) as string;

  // Start with frontmatter connections
  const connections: Connection[] = (fm.connections ?? []).map(c => ({
    to: c.to,
    type: 'frontmatter' as const,
    description: c.description ?? '',
    source: 'frontmatter' as const,
  }));

  // Extract inline markdown links: [text](target)
  const connectedTo = new Set(connections.map(c => c.to));
  for (const m of content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const target = m[2].trim();
    if (target.startsWith('http') || target.startsWith('#') || target.startsWith('/')) continue;
    if (target.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i)) continue;
    if (connectedTo.has(target)) continue;
    connections.push({ to: target, type: 'references', description: m[1], source: 'inline' });
    connectedTo.add(target);
  }

  // Extract file path references: src/path/file.ts, scripts/file.js, etc.
  for (const m of content.matchAll(/(?:src|scripts|content|public)\/[\w./-]+\.\w+/g)) {
    const filePath = m[0];
    const fileNodeId = `file-${filePath}`;
    if (connectedTo.has(fileNodeId)) continue;
    connections.push({ to: fileNodeId, type: 'references', description: `References ${filePath}`, source: 'inferred' });
    connectedTo.add(fileNodeId);
  }

  // Implicit link back to source file
  const sourceFileId = `file-${path}`;
  if (!connectedTo.has(sourceFileId)) {
    connections.push({ to: sourceFileId, type: 'derived_from', description: 'Derived from', source: 'inferred' });
  }

  const node: KBNode = {
    id,
    title: fm.title ?? id,
    cluster: fm.cluster ?? 'default',
    content: html,
    rawContent: content,
    emoji: fm.emoji,
    image: fm.image,
    sprite: fm.sprite,
    parent: fm.parent,
    derived: fm.derived === true,
    display: fm.display,
    connections,
    source: { type: 'authored', file: path },
  };
  node.identity = assignIdentity(node);
  return node;
}

/** Load authored content from a content directory in the repo. */
export async function loadAuthoredContent(
  source: SourceConfig,
  contentPath: string
): Promise<KBNode[]> {
  const tree = await fetchTree(source, contentPath);
  const mdFiles = tree
    .filter(item => item.type === 'blob' && item.path.endsWith('.md'))
    .map(item => item.path);

  const files = await fetchFiles(source, mdFiles);
  const nodes: KBNode[] = [];

  for (const [path, content] of files) {
    try {
      nodes.push(parseMarkdownFile(path, content));
    } catch {
      console.warn(`[kbexplorer] Failed to parse ${path}, skipping`);
    }
  }

  return nodes;
}

// ── Repo-aware mode ────────────────────────────────────────

/** Fluent icon name mapping for issue types / labels. */
const ISSUE_TYPE_ICON: Record<string, string> = {
  epic: 'Flag',
  feature: 'Sparkle',
  task: 'Wrench',
  bug: 'Bug',
  enhancement: 'Lightbulb',
  documentation: 'Document',
  question: 'QuestionCircle',
};

function issueIcon(labels: string[]): string {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (ISSUE_TYPE_ICON[lower]) return ISSUE_TYPE_ICON[lower];
  }
  return 'Pin';
}

/** Extract issue cross-references (#N) from body text. */
export function extractIssueRefs(body: string | null): number[] {
  if (!body) return [];
  const matches = body.matchAll(/#(\d+)/g);
  return [...matches].map(m => Number(m[1]));
}

export function issueToNode(issue: GHIssue): KBNode {
  const labels = issue.labels.map(l => l.name);
  const cluster = labels[0]?.toLowerCase() ?? 'uncategorized';
  const body = issue.body ?? '';

  // Remap GitHub issue/PR links to graph node links
  const remappedBody = body
    .replace(/https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/g, (_m, num) => `issue-${num}`)
    .replace(/https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/g, (_m, num) => `pr-${num}`)

  const refs = extractIssueRefs(body);
  // Also extract PR references from body
  const prRefs = [...body.matchAll(/(?:^|\s)#(\d+)/g)].map(m => Number(m[1]));

  // Build rich metadata header
  const stateEmoji = issue.state === 'open' ? '🟢' : '🟣';
  const labelBadges = labels.map(l => `\`${l}\``).join(' ');
  const assigneeList = issue.assignees?.length
    ? issue.assignees.map(a => `@${a.login}`).join(', ')
    : '';
  const created = new Date(issue.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const updated = new Date(issue.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const metaLines = [
    `${stateEmoji} **${issue.state.toUpperCase()}** · #${issue.number}`,
    labelBadges ? `Labels: ${labelBadges}` : '',
    assigneeList ? `Assignees: ${assigneeList}` : '',
    `Created: ${created} · Updated: ${updated}`,
    `[View on GitHub ↗](${issue.html_url})`,
  ].filter(Boolean).join('\n\n');

  const fullContent = `${metaLines}\n\n---\n\n${remappedBody}`;
  const html = marked.parse(fullContent, { async: false }) as string;

  // Build connections — both issue refs and PR refs
  const connections: Connection[] = [];
  const seen = new Set<string>();
  for (const n of refs) {
    const to = `issue-${n}`;
    if (!seen.has(to)) {
      connections.push({ to, type: 'cross_references', description: `References #${n}`, source: 'inline' });
      seen.add(to);
    }
  }
  for (const n of prRefs) {
    const prTo = `pr-${n}`;
    if (!seen.has(prTo) && !seen.has(`issue-${n}`)) {
      // Could be a PR reference — add both possibilities
      connections.push({ to: `issue-${n}`, type: 'cross_references', description: `References #${n}`, source: 'inline' });
      seen.add(`issue-${n}`);
    }
  }

  const node: KBNode = {
    id: `issue-${issue.number}`,
    title: issue.title,
    cluster,
    content: html,
    rawContent: fullContent,
    emoji: issueIcon(labels),
    connections,
    source: { type: 'issue', number: issue.number, state: issue.state, labels },
  };
  node.identity = assignIdentity(node);
  return node;
}

/** Split a markdown document into parent + section nodes at ## headings. */
export function splitIntoSections(
  parentId: string,
  parentTitle: string,
  rawContent: string,
  cluster: string,
  emoji: string,
  source: KBNode['source'],
  allNodes: KBNode[],
): KBNode[] {
  const lines = rawContent.split('\n');
  const sections: { title: string; lines: string[] }[] = [];
  let currentSection: { title: string; lines: string[] } | null = null;
  const introLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentSection) sections.push(currentSection);
      currentSection = { title: headingMatch[1].trim(), lines: [] };
    } else if (currentSection) {
      currentSection.lines.push(line);
    } else {
      introLines.push(line);
    }
  }
  if (currentSection) sections.push(currentSection);

  // If fewer than 2 sections, don't split — return single node
  if (sections.length < 2) return [];

  const result: KBNode[] = [];
  const introContent = introLines.join('\n').trim();
  const introHtml = introContent ? marked.parse(introContent, { async: false }) as string : '';

  // Parent node — contains intro text, connects to all sections
  const sectionIds = sections.map((s, i) => `${parentId}/${slugify(s.title, i)}`);
  const parentNode: KBNode = {
    id: parentId,
    title: parentTitle,
    cluster,
    content: introHtml,
    rawContent: introContent,
    emoji,
    nodeType: 'parent',
    connections: sectionIds.map(sid => ({ to: sid, type: 'contains' as const, description: 'Contains', source: 'inferred' as const })),
    source,
  };

  // Content-based connections from parent to other existing nodes
  const lower = rawContent.toLowerCase();
  for (const n of allNodes) {
    if (n.id === parentId) continue;
    const titleWords = n.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (titleWords.length === 0) continue;
    const matchCount = titleWords.filter(w => lower.includes(w)).length;
    if (matchCount >= Math.ceil(titleWords.length * 0.6)) {
      parentNode.connections.push({ to: n.id, type: 'mentions', description: 'Mentions', source: 'inferred' });
    }
  }

  result.push(parentNode);

  // Section nodes
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const sectionBody = s.lines.join('\n').trim();
    const sectionHtml = sectionBody ? marked.parse(sectionBody, { async: false }) as string : '';
    const sectionNode: KBNode = {
      id: sectionIds[i],
      title: s.title,
      cluster,
      content: sectionHtml,
      rawContent: sectionBody,
      emoji,
      parent: parentId,
      nodeType: 'section',
      connections: [],
      source,
    };

    // Cross-reference other sections via #N or title mentions
    const sLower = sectionBody.toLowerCase();
    const refs = extractIssueRefs(sectionBody);
    for (const num of refs) {
      const refId = `issue-${num}`;
      if (allNodes.some(n => n.id === refId)) {
        sectionNode.connections.push({ to: refId, type: 'cross_references', description: `References #${num}`, source: 'inline' });
      }
    }
    // Link to directories mentioned
    for (const n of allNodes) {
      if (n.source.type === 'file') {
        const dirName = n.title.replace(/\/$/, '').toLowerCase();
        if (sLower.includes(`${dirName}/`) || sLower.includes(`\`${dirName}\``)) {
          sectionNode.connections.push({ to: n.id, type: 'references', description: `References ${n.title}`, source: 'inferred' });
        }
      }
    }

    result.push(sectionNode);
  }

  return result;
}

function slugify(title: string, idx: number): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `section-${idx}`;
}
/** Key file extensions worth surfacing as individual nodes. */
const KEY_EXTENSIONS = new Set(['.ts', '.tsx', '.md', '.json', '.yaml', '.yml', '.css']);
const SKIP_FILES = new Set(['package-lock.json', '.gitignore', '.eslintrc.json']);

/** Build nodes from the file tree: repo root + directories + key files. */
export function treeToNodes(tree: GHTreeItem[], repoName: string, excludePaths?: string[]): KBNode[] {
  const nodes: KBNode[] = [];
  const dirs = new Map<string, GHTreeItem[]>();
  const excludeSet = new Set(excludePaths ?? []);

  for (const item of tree) {
    if (item.path.startsWith('.')) continue;
    const parts = item.path.split('/');
    if (parts[0].startsWith('.')) continue;
    if (excludeSet.has(parts[0])) continue; // skip authored content dirs
    if (item.type === 'tree') continue;

    const dirPath = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join('/') : '';
    if (dirPath) {
      if (!dirs.has(dirPath)) dirs.set(dirPath, []);
      dirs.get(dirPath)!.push(item);
    }
  }

  // Repo root node
  const topDirs = [...dirs.keys()].filter(d => !d.includes('/'));
  const rootFiles = tree.filter(i => i.type === 'blob' && !i.path.includes('/') && !i.path.startsWith('.'));
  const rootContent = `## ${repoName}\n\n${topDirs.length} directories, ${rootFiles.length} root files`;
  const rootHtml = marked.parse(rootContent, { async: false }) as string;
  const rootNode: KBNode = {
    id: 'repo-root',
    title: repoName,
    cluster: 'code',
    content: rootHtml,
    rawContent: rootContent,
    emoji: 'Folder',
    nodeType: 'parent',
    connections: [],
    source: { type: 'file', path: '/' },
  };
  rootNode.identity = assignIdentity(rootNode);
  nodes.push(rootNode);

  // Directory nodes — top-level are children of repo-root
  for (const [dirPath, files] of dirs) {
    const depth = dirPath.split('/').length;
    const parentId = depth === 1 ? 'repo-root' : `dir-${dirPath.split('/')[0]}`;
    const fileList = files.slice(0, 15).map(f => `- \`${f.path}\``).join('\n');
    const content = `## ${dirPath}/\n\n${files.length} files\n\n${fileList}`;
    const html = marked.parse(content, { async: false }) as string;

    nodes.push({
      id: `dir-${dirPath}`,
      title: `${dirPath}/`,
      cluster: 'code',
      content: html,
      rawContent: content,
      emoji: 'Folder',
      parent: parentId,
      nodeType: depth === 1 ? 'parent' : 'section',
      connections: [],
      identity: `urn:file:${dirPath}`,
      source: { type: 'file', path: dirPath },
    });
  }

  // File nodes inside directories (key source files)
  for (const item of tree) {
    if (item.type !== 'blob') continue;
    if (item.path.startsWith('.')) continue;
    const parts = item.path.split('/');
    if (parts[0].startsWith('.')) continue;
    if (excludeSet.has(parts[0])) continue; // skip authored content files
    if (SKIP_FILES.has(parts[parts.length - 1])) continue;
    const ext = '.' + item.path.split('.').pop()?.toLowerCase();
    if (!KEY_EXTENSIONS.has(ext)) continue;
    if (item.path === 'README.md') continue;

    // Find parent dir (up to 2 levels)
    const parentDir = parts.length > 2
      ? `dir-${parts[0]}/${parts[1]}`
      : parts.length > 1
      ? `dir-${parts[0]}`
      : 'repo-root';

    nodes.push({
      id: `file-${item.path}`,
      title: parts[parts.length - 1],
      cluster: 'code',
      content: `<p><code>${item.path}</code></p>`,
      rawContent: item.path,
      emoji: 'Document',
      parent: parentDir,
      nodeType: 'section',
      connections: [],
      identity: `urn:file:${item.path}`,
      source: { type: 'file', path: item.path },
    });
  }

  return nodes;
}

/** Load repo-aware content: issues, README, and directory structure. */
export async function loadRepoContent(source: SourceConfig): Promise<KBNode[]> {
  const [issues, tree, readme] = await Promise.all([
    fetchIssues(source).catch(() => [] as GHIssue[]),
    fetchTree(source).catch(() => [] as GHTreeItem[]),
    fetchFile(source, 'README.md').catch(() => null),
  ]);

  const nodes: KBNode[] = [];

  const issueNodes = issues.map(issueToNode);
  const dirNodes = treeToNodes(tree, source.repo);

  nodes.push(...issueNodes);
  nodes.push(...dirNodes);

  // README as a single node with content-based connections
  if (readme) {
    const readmeConns: Connection[] = [];
    const lower = readme.toLowerCase();
    const issueRefs = extractIssueRefs(readme);
    for (const num of issueRefs) {
      const id = `issue-${num}`;
      if (issueNodes.some(n => n.id === id)) {
        readmeConns.push({ to: id, type: 'cross_references', description: `References #${num}`, source: 'inline' });
      }
    }
    for (const node of issueNodes) {
      if (readmeConns.some(c => c.to === node.id)) continue;
      const titleWords = node.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (titleWords.length === 0) continue;
      const matchCount = titleWords.filter(w => lower.includes(w)).length;
      if (matchCount >= Math.ceil(titleWords.length * 0.6)) {
        readmeConns.push({ to: node.id, type: 'mentions', description: 'Mentions', source: 'inferred' });
      }
    }
    for (const dir of dirNodes) {
      const dirName = dir.title.replace(/\/$/, '');
      if (lower.includes(`${dirName}/`) || lower.includes(`\`${dirName}\``)) {
        readmeConns.push({ to: dir.id, type: 'references', description: `References ${dirName}/`, source: 'inferred' });
      }
    }
    readmeConns.push({ to: 'repo-root', type: 'contains', description: 'Documents', source: 'inferred' });

    // Extract inline markdown links from README body: [text](target)
    const readmeConnectedTo = new Set(readmeConns.map(c => c.to));
    for (const m of readme.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
      const target = m[2].trim();
      if (target.startsWith('http') || target.startsWith('#') || target.startsWith('/')) continue;
      if (target.match(/\.(png|jpg|jpeg|gif|svg|webp|md)$/i)) continue;
      if (readmeConnectedTo.has(target)) continue;
      readmeConns.push({ to: target, type: 'references', description: m[1], source: 'inline' });
      readmeConnectedTo.add(target);
    }

    const html = marked.parse(readme, { async: false }) as string;
    nodes.push({
      id: 'readme', title: 'README', cluster: 'docs',
      content: html, rawContent: readme, emoji: 'Document',
      parent: 'repo-root',
      identity: 'urn:content:readme',
      connections: readmeConns, source: { type: 'readme' },
    });
  }

  // Split issues with 2+ headings into parent + section nodes
  const expandedIssues: KBNode[] = [];
  for (const node of issueNodes) {
    const sectionNodes = splitIntoSections(
      node.id, node.title, node.rawContent, node.cluster, node.emoji ?? 'Pin',
      node.source, [...issueNodes, ...dirNodes],
    );
    if (sectionNodes.length > 0) {
      // Replace flat issue with parent + sections
      const idx = nodes.indexOf(node);
      if (idx >= 0) nodes.splice(idx, 1);
      expandedIssues.push(...sectionNodes);
    }
  }
  nodes.push(...expandedIssues);

  // Auto-link: issues → directories mentioned in their body
  const dirNames = dirNodes.map(d => d.title.replace(/\/$/, '')); // e.g. "src", "public"
  for (const node of issueNodes) {
    for (let i = 0; i < dirNames.length; i++) {
      const dir = dirNames[i];
      if (node.rawContent && (
        node.rawContent.includes(`${dir}/`) ||
        node.rawContent.includes(`\`${dir}\``) ||
        node.rawContent.toLowerCase().includes(dir.toLowerCase())
      )) {
        node.connections.push({ to: dirNodes[i].id, type: 'references', description: `References ${dir}/`, source: 'inferred' });
      }
    }
  }

  return nodes;
}

// ── Cluster extraction ─────────────────────────────────────

/** Extract cluster definitions from nodes + config. */
export function extractClusters(
  nodes: KBNode[],
  config: KBConfig
): Cluster[] {
  const configClusters = new Map(
    Object.entries(config.clusters).map(([id, c]) => [id, { id, ...c }])
  );

  // Auto-generate cluster colors for clusters not in config
  const palette = [
    '#E8A838', '#4A9CC8', '#8CB050', '#C07840',
    '#D4A050', '#5A98A8', '#9A8A78', '#C04040',
    '#A86FDF', '#39FF14', '#FF6B6B', '#4ECDC4',
  ];
  let colorIdx = 0;

  const seenIds = new Set<string>();
  for (const node of nodes) {
    if (!seenIds.has(node.cluster)) {
      seenIds.add(node.cluster);
      if (!configClusters.has(node.cluster)) {
        configClusters.set(node.cluster, {
          id: node.cluster,
          name: node.cluster
            .split(/[-_]/)
            .map(w => w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))
            .join(' '),
          color: palette[colorIdx % palette.length],
        });
        colorIdx++;
      }
    }
  }

  return [...configClusters.values()];
}

// ── Config loading ─────────────────────────────────────────

/** Try to load config.yaml from the repo. Falls back to DEFAULT_CONFIG. */
export async function loadConfig(source: SourceConfig): Promise<KBConfig> {
  try {
    const raw = await fetchFile(source, source.path
      ? `${source.path}/config.yaml`
      : 'content/config.yaml'
    );
    const parsed = yaml.parse(raw) as Partial<KBConfig>;
    return { ...DEFAULT_CONFIG, ...parsed, source };
  } catch {
    return { ...DEFAULT_CONFIG, source };
  }
}
