/**
 * Content parser: transforms raw GitHub data into KBNode[] for the graph engine.
 *
 * Two modes:
 *   - authored: parses markdown files with YAML frontmatter
 *   - repo-aware: maps GitHub issues, PRs, README, and file tree to nodes
 */
import matter from 'gray-matter';
import { marked } from 'marked';
import type {
  KBNode,
  KBConfig,
  Cluster,
  SourceConfig,
} from '../types';
import { DEFAULT_CONFIG } from '../types';
import {
  fetchFile,
  fetchTree,
  fetchFiles,
  fetchIssues,
  fetchPullRequests,
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
  connections?: Array<{ to: string; description: string }>;
}

function parseMarkdownFile(path: string, raw: string): KBNode {
  const { data, content } = matter(raw);
  const fm = data as Partial<AuthoredFrontmatter>;

  const id = fm.id ?? path.replace(/\.md$/, '').replace(/.*\//, '');
  const html = marked.parse(content, { async: false }) as string;

  return {
    id,
    title: fm.title ?? id,
    cluster: fm.cluster ?? 'default',
    content: html,
    rawContent: content,
    emoji: fm.emoji,
    image: fm.image,
    sprite: fm.sprite,
    parent: fm.parent,
    connections: (fm.connections ?? []).map(c => ({
      to: c.to,
      description: c.description ?? '',
    })),
    source: { type: 'authored', file: path },
  };
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

/** Emoji mapping for issue types / labels. */
const ISSUE_TYPE_EMOJI: Record<string, string> = {
  epic: '🏔️',
  feature: '✨',
  task: '🔧',
  bug: '🐛',
  enhancement: '💡',
  documentation: '📖',
  question: '❓',
};

function issueEmoji(labels: string[]): string {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (ISSUE_TYPE_EMOJI[lower]) return ISSUE_TYPE_EMOJI[lower];
  }
  return '📌';
}

/** Extract issue cross-references (#N) from body text. */
function extractIssueRefs(body: string | null): number[] {
  if (!body) return [];
  const matches = body.matchAll(/#(\d+)/g);
  return [...matches].map(m => Number(m[1]));
}

function issueToNode(issue: GHIssue): KBNode {
  const labels = issue.labels.map(l => l.name);
  const cluster = labels[0]?.toLowerCase() ?? 'uncategorized';
  const body = issue.body ?? '';
  const html = marked.parse(body, { async: false }) as string;
  const refs = extractIssueRefs(body);

  return {
    id: `issue-${issue.number}`,
    title: issue.title,
    cluster,
    content: html,
    rawContent: body,
    emoji: issueEmoji(labels),
    connections: refs.map(n => ({
      to: `issue-${n}`,
      description: `References #${n}`,
    })),
    source: { type: 'issue', number: issue.number, state: issue.state, labels },
  };
}

function prToNode(pr: GHIssue): KBNode {
  const body = pr.body ?? '';
  const html = marked.parse(body, { async: false }) as string;
  const refs = extractIssueRefs(body);

  return {
    id: `pr-${pr.number}`,
    title: pr.title,
    cluster: 'pull-request',
    content: html,
    rawContent: body,
    emoji: pr.state === 'open' ? '🟢' : '🟣',
    connections: refs.map(n => ({
      to: `issue-${n}`,
      description: `Addresses #${n}`,
    })),
    source: { type: 'pull_request', number: pr.number, state: pr.state },
  };
}

function readmeToNode(content: string): KBNode {
  const html = marked.parse(content, { async: false }) as string;
  return {
    id: 'readme',
    title: 'README',
    cluster: 'docs',
    content: html,
    rawContent: content,
    emoji: '📖',
    connections: [],
    source: { type: 'readme' },
  };
}

/** Group tree items into top-level directory nodes. */
function treeToNodes(tree: GHTreeItem[]): KBNode[] {
  const topDirs = new Set<string>();
  for (const item of tree) {
    const parts = item.path.split('/');
    if (parts.length > 1 && !parts[0].startsWith('.')) {
      topDirs.add(parts[0]);
    }
  }

  return [...topDirs].map(dir => {
    const files = tree.filter(
      i => i.path.startsWith(dir + '/') && i.type === 'blob'
    );
    const fileList = files
      .slice(0, 20)
      .map(f => `- \`${f.path}\``)
      .join('\n');
    const content = `## ${dir}/\n\n${files.length} files\n\n${fileList}`;
    const html = marked.parse(content, { async: false }) as string;

    return {
      id: `dir-${dir}`,
      title: `${dir}/`,
      cluster: 'code',
      content: html,
      rawContent: content,
      emoji: '📁',
      connections: [],
      source: { type: 'file' as const, path: dir },
    };
  });
}

/** Load repo-aware content: issues, PRs, README, and directory structure. */
export async function loadRepoContent(source: SourceConfig): Promise<KBNode[]> {
  const [issues, prs, tree, readme] = await Promise.all([
    fetchIssues(source).catch(() => [] as GHIssue[]),
    fetchPullRequests(source).catch(() => [] as GHIssue[]),
    fetchTree(source).catch(() => [] as GHTreeItem[]),
    fetchFile(source, 'README.md').catch(() => null),
  ]);

  const nodes: KBNode[] = [];

  if (readme) {
    nodes.push(readmeToNode(readme));
  }

  nodes.push(...issues.map(issueToNode));
  nodes.push(...prs.map(prToNode));
  nodes.push(...treeToNodes(tree));

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
          name: node.cluster.charAt(0).toUpperCase() + node.cluster.slice(1),
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
    const yaml = await import('yaml');
    const parsed = yaml.parse(raw) as Partial<KBConfig>;
    return { ...DEFAULT_CONFIG, ...parsed, source };
  } catch {
    return { ...DEFAULT_CONFIG, source };
  }
}
