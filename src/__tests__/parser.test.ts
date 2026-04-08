import { describe, it, expect } from 'vitest';
import {
  parseMarkdownFile,
  issueToNode,
  treeToNodes,
  extractIssueRefs,
  extractClusters,
} from '../parser';
import type { GHIssue, GHTreeItem } from '../../api';
import { DEFAULT_CONFIG } from '../../types';

// ── parseMarkdownFile ──────────────────────────────────────

describe('parseMarkdownFile', () => {
  it('parses frontmatter and content', () => {
    const raw = `---
id: test-node
title: Test Node
emoji: "🔧"
cluster: engine
connections:
  - to: other
    description: "links to"
---

# Test Node

Body text.`;

    const node = parseMarkdownFile('content/test.md', raw);
    expect(node.id).toBe('test-node');
    expect(node.title).toBe('Test Node');
    expect(node.cluster).toBe('engine');
    expect(node.emoji).toBe('🔧');
    expect(node.connections).toHaveLength(1);
    expect(node.connections[0].to).toBe('other');
    expect(node.content).toContain('<h1>');
    expect(node.source).toEqual({ type: 'authored', file: 'content/test.md' });
  });

  it('generates id from filename when no frontmatter id', () => {
    const raw = '# Just a heading\n\nSome content.';
    const node = parseMarkdownFile('content/my-page.md', raw);
    expect(node.id).toBe('my-page');
  });

  it('handles empty connections', () => {
    const raw = `---
id: solo
title: Solo Node
cluster: misc
---

Content here.`;

    const node = parseMarkdownFile('content/solo.md', raw);
    expect(node.connections).toEqual([]);
  });

  it('handles missing frontmatter', () => {
    const raw = '# No Frontmatter\n\nPlain markdown.';
    const node = parseMarkdownFile('content/plain.md', raw);
    expect(node.cluster).toBe('default');
    expect(node.rawContent).toContain('# No Frontmatter');
  });
});

// ── issueToNode ────────────────────────────────────────────

describe('issueToNode', () => {
  const mockIssue: GHIssue = {
    number: 42,
    title: 'Fix the widget',
    body: 'This relates to #10 and #15.',
    state: 'open',
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: [],
    html_url: 'https://github.com/test/repo/issues/42',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  };

  it('creates a node with correct id', () => {
    const node = issueToNode(mockIssue);
    expect(node.id).toBe('issue-42');
  });

  it('uses first label as cluster', () => {
    const node = issueToNode(mockIssue);
    expect(node.cluster).toBe('bug');
  });

  it('extracts issue cross-references as connections', () => {
    const node = issueToNode(mockIssue);
    expect(node.connections).toHaveLength(2);
    expect(node.connections[0].to).toBe('issue-10');
    expect(node.connections[1].to).toBe('issue-15');
  });

  it('renders body as HTML', () => {
    const node = issueToNode(mockIssue);
    expect(node.content).toContain('<p>');
  });

  it('handles null body', () => {
    const node = issueToNode({ ...mockIssue, body: null });
    expect(node.rawContent).toBe('');
    expect(node.connections).toEqual([]);
  });

  it('handles no labels', () => {
    const node = issueToNode({ ...mockIssue, labels: [] });
    expect(node.cluster).toBe('uncategorized');
  });
});

// ── extractIssueRefs ───────────────────────────────────────

describe('extractIssueRefs', () => {
  it('extracts #N references', () => {
    expect(extractIssueRefs('See #1 and #23')).toEqual([1, 23]);
  });

  it('returns empty for null body', () => {
    expect(extractIssueRefs(null)).toEqual([]);
  });

  it('returns empty for no refs', () => {
    expect(extractIssueRefs('No references here')).toEqual([]);
  });
});

// ── treeToNodes ────────────────────────────────────────────

describe('treeToNodes', () => {
  const mockTree: GHTreeItem[] = [
    { path: 'src', type: 'tree', mode: '', sha: '', url: '' },
    { path: 'src/App.tsx', type: 'blob', mode: '', sha: '', size: 100, url: '' },
    { path: 'src/index.ts', type: 'blob', mode: '', sha: '', size: 50, url: '' },
    { path: 'public', type: 'tree', mode: '', sha: '', url: '' },
    { path: 'public/favicon.svg', type: 'blob', mode: '', sha: '', size: 200, url: '' },
    { path: 'README.md', type: 'blob', mode: '', sha: '', size: 500, url: '' },
  ];

  it('creates repo-root node', () => {
    const nodes = treeToNodes(mockTree, 'test-repo');
    expect(nodes.some(n => n.id === 'repo-root')).toBe(true);
  });

  it('creates directory nodes as children of repo-root', () => {
    const nodes = treeToNodes(mockTree, 'test-repo');
    const srcNode = nodes.find(n => n.id === 'dir-src');
    expect(srcNode).toBeDefined();
    expect(srcNode?.parent).toBe('repo-root');
  });

  it('creates file nodes inside directories', () => {
    const nodes = treeToNodes(mockTree, 'test-repo');
    const appNode = nodes.find(n => n.id === 'file-src/App.tsx');
    expect(appNode).toBeDefined();
    expect(appNode?.parent).toBe('dir-src');
  });

  it('excludes paths in excludePaths', () => {
    const nodes = treeToNodes(mockTree, 'test-repo', ['src']);
    expect(nodes.some(n => n.id === 'dir-src')).toBe(false);
    expect(nodes.some(n => n.id === 'file-src/App.tsx')).toBe(false);
  });
});

// ── extractClusters ────────────────────────────────────────

describe('extractClusters', () => {
  it('merges config clusters with auto-detected ones', () => {
    const nodes = [
      { id: '1', cluster: 'engine', title: '', content: '', rawContent: '', connections: [], source: { type: 'authored' as const, file: '' } },
      { id: '2', cluster: 'custom', title: '', content: '', rawContent: '', connections: [], source: { type: 'authored' as const, file: '' } },
    ];
    const clusters = extractClusters(nodes, DEFAULT_CONFIG);
    expect(clusters.some(c => c.id === 'custom')).toBe(true);
    expect(clusters.find(c => c.id === 'custom')?.color).toBeDefined();
  });
});
