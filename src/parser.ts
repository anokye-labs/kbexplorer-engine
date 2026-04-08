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
  Connection,
  SourceConfig,
} from '../types';
import { DEFAULT_CONFIG } from '../types';
import {
  fetchFile,
  fetchTree,
  fetchFiles,
  fetchIssues,
  fetchPullRequests,
  fetchCommits,
  type GHIssue,
  type GHTreeItem,
  type GHCommit,
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
    emoji: issueIcon(labels),
    connections: refs.map(n => ({
      to: `issue-${n}`,
      description: `References #${n}`,
    })),
    source: { type: 'issue', number: issue.number, state: issue.state, labels },
  };
}

/** Split a markdown document into parent + section nodes at ## headings. */
function splitIntoSections(
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
    connections: sectionIds.map(sid => ({ to: sid, description: 'Contains' })),
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
      parentNode.connections.push({ to: n.id, description: 'Mentions' });
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
        sectionNode.connections.push({ to: refId, description: `References #${num}` });
      }
    }
    // Link to directories mentioned
    for (const n of allNodes) {
      if (n.source.type === 'file') {
        const dirName = n.title.replace(/\/$/, '').toLowerCase();
        if (sLower.includes(`${dirName}/`) || sLower.includes(`\`${dirName}\``)) {
          sectionNode.connections.push({ to: n.id, description: `References ${n.title}` });
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

/** Build nodes from the file tree: directories + key files. */
function treeToNodes(tree: GHTreeItem[]): KBNode[] {
  const nodes: KBNode[] = [];
  const dirs = new Map<string, GHTreeItem[]>(); // dir path → child blobs

  for (const item of tree) {
    if (item.path.startsWith('.')) continue;
    const parts = item.path.split('/');
    if (parts[0].startsWith('.')) continue;

    if (item.type === 'tree') continue; // we infer dirs from blobs

    // Group into directories (1st and 2nd level)
    const dirPath = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join('/') : '';
    if (dirPath) {
      if (!dirs.has(dirPath)) dirs.set(dirPath, []);
      dirs.get(dirPath)!.push(item);
    }
  }

  // Directory nodes
  for (const [dirPath, files] of dirs) {
    const depth = dirPath.split('/').length;
    const parentDir = depth > 1 ? dirPath.split('/')[0] : undefined;
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
      parent: parentDir ? `dir-${parentDir}` : undefined,
      nodeType: depth === 1 ? 'parent' : 'section',
      connections: [],
      source: { type: 'file', path: dirPath },
    });
  }

  // Add parent→child connections for directories
  for (const [dirPath] of dirs) {
    const parts = dirPath.split('/');
    if (parts.length > 1) {
      const parentId = `dir-${parts[0]}`;
      const parentNode = nodes.find(n => n.id === parentId);
      if (parentNode) {
        parentNode.connections.push({ to: `dir-${dirPath}`, description: 'Contains' });
      }
    }
  }

  // Key individual file nodes (top-level config files, root .md files)
  for (const item of tree) {
    if (item.type !== 'blob') continue;
    if (item.path.includes('/')) continue; // only root-level files
    if (item.path.startsWith('.')) continue;
    if (SKIP_FILES.has(item.path)) continue;
    const ext = '.' + item.path.split('.').pop()?.toLowerCase();
    if (!KEY_EXTENSIONS.has(ext) && item.path !== 'Dockerfile') continue;
    if (item.path === 'README.md') continue; // handled separately

    nodes.push({
      id: `file-${item.path}`,
      title: item.path,
      cluster: 'code',
      content: `<p>Root file: <code>${item.path}</code></p>`,
      rawContent: item.path,
      emoji: 'Document',
      nodeType: 'section',
      connections: [],
      source: { type: 'file', path: item.path },
    });
  }

  return nodes;
}

/** Convert a PR to a node. */
function prToNode(pr: GHIssue): KBNode {
  const body = pr.body ?? '';
  const html = marked.parse(body, { async: false }) as string;
  const refs = extractIssueRefs(body);

  return {
    id: `pr-${pr.number}`,
    title: `PR #${pr.number}: ${pr.title}`,
    cluster: 'pull-request',
    content: html,
    rawContent: body,
    emoji: 'Merge',
    connections: refs.map(n => ({
      to: `issue-${n}`,
      description: `Closes #${n}`,
    })),
    source: { type: 'pull_request', number: pr.number, state: pr.state },
  };
}

/** Convert a commit to a node. */
function commitToNode(commit: GHCommit, allDirIds: Set<string>, allFileIds: Set<string>): KBNode {
  const msg = commit.commit.message;
  const firstLine = msg.split('\n')[0];
  const body = msg.split('\n').slice(1).join('\n').trim();
  const html = marked.parse(msg, { async: false }) as string;

  const connections: Connection[] = [];

  // Connect to issues/PRs via #N references in message
  const refs = extractIssueRefs(msg);
  for (const n of refs) {
    connections.push({ to: `issue-${n}`, description: `References #${n}` });
    connections.push({ to: `pr-${n}`, description: `Part of PR #${n}` });
  }

  // Connect to directories and files touched
  if (commit.files) {
    const touchedDirs = new Set<string>();
    for (const f of commit.files) {
      const parts = f.filename.split('/');
      // Connect to individual file nodes (root files)
      const fileId = `file-${f.filename}`;
      if (allFileIds.has(fileId)) {
        connections.push({ to: fileId, description: f.status ?? 'modified' });
      }
      // Connect to directories
      if (parts.length > 1) {
        touchedDirs.add(parts[0]);
        if (parts.length > 2) touchedDirs.add(`${parts[0]}/${parts[1]}`);
      }
    }
    for (const dir of touchedDirs) {
      const dirId = `dir-${dir}`;
      if (allDirIds.has(dirId)) {
        connections.push({ to: dirId, description: `Modifies ${dir}/` });
      }
    }
  }

  return {
    id: `commit-${commit.sha.substring(0, 7)}`,
    title: firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine,
    cluster: 'commits',
    content: html,
    rawContent: body,
    emoji: 'BranchFork',
    nodeType: 'section',
    connections,
    source: { type: 'commit', sha: commit.sha },
  };
}

/** Load repo-aware content: issues, PRs, commits, README, and directory structure. */
export async function loadRepoContent(source: SourceConfig): Promise<KBNode[]> {
  const [issues, prs, commits, tree, readme] = await Promise.all([
    fetchIssues(source).catch(() => [] as GHIssue[]),
    fetchPullRequests(source).catch(() => [] as GHIssue[]),
    fetchCommits(source, 20).catch(() => [] as GHCommit[]),
    fetchTree(source).catch(() => [] as GHTreeItem[]),
    fetchFile(source, 'README.md').catch(() => null),
  ]);

  const nodes: KBNode[] = [];

  const issueNodes = issues.map(issueToNode);
  const prNodes = prs.map(prToNode);
  const dirNodes = treeToNodes(tree);
  const dirIdSet = new Set(dirNodes.map(n => n.id));
  const fileIdSet = new Set(dirNodes.filter(n => n.source.type === 'file').map(n => n.id));
  const commitNodes = commits.map(c => commitToNode(c, dirIdSet, fileIdSet));

  // Connect PRs ↔ commits: match merge commit messages referencing PR numbers
  for (const pr of prNodes) {
    const prNum = (pr.source as { number: number }).number;
    for (const commit of commitNodes) {
      const msg = commit.rawContent || commit.title;
      // Merge commits say "Merge pull request #N" or just reference #N
      if (msg.includes(`#${prNum}`) || commit.title.includes(`#${prNum}`)) {
        pr.connections.push({ to: commit.id, description: 'Merged via' });
        commit.connections.push({ to: pr.id, description: `Part of PR #${prNum}` });
      }
    }
  }

  nodes.push(...issueNodes);
  nodes.push(...prNodes);
  nodes.push(...dirNodes);
  nodes.push(...commitNodes);

  // README as a single node with content-based connections
  if (readme) {
    const readmeConns: Array<{ to: string; description: string }> = [];
    const lower = readme.toLowerCase();
    const issueRefs = extractIssueRefs(readme);
    for (const num of issueRefs) {
      const id = `issue-${num}`;
      if (issueNodes.some(n => n.id === id)) {
        readmeConns.push({ to: id, description: `References #${num}` });
      }
    }
    for (const node of issueNodes) {
      if (readmeConns.some(c => c.to === node.id)) continue;
      const titleWords = node.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (titleWords.length === 0) continue;
      const matchCount = titleWords.filter(w => lower.includes(w)).length;
      if (matchCount >= Math.ceil(titleWords.length * 0.6)) {
        readmeConns.push({ to: node.id, description: 'Mentions' });
      }
    }
    for (const dir of dirNodes) {
      const dirName = dir.title.replace(/\/$/, '');
      if (lower.includes(`${dirName}/`) || lower.includes(`\`${dirName}\``)) {
        readmeConns.push({ to: dir.id, description: `References ${dirName}/` });
      }
    }
    const html = marked.parse(readme, { async: false }) as string;
    nodes.push({
      id: 'readme', title: 'README', cluster: 'docs',
      content: html, rawContent: readme, emoji: 'Document',
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
        node.connections.push({ to: dirNodes[i].id, description: `References ${dir}/` });
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
    const yaml = await import('yaml');
    const parsed = yaml.parse(raw) as Partial<KBConfig>;
    return { ...DEFAULT_CONFIG, ...parsed, source };
  } catch {
    return { ...DEFAULT_CONFIG, source };
  }
}
