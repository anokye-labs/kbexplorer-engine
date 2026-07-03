import { describe, it, expect } from 'vitest';
import {
  parseMarkdownFile,
  issueToNode,
  treeToNodes,
  extractIssueRefs,
  extractClusters,
} from '../parser';
import type { GHIssue, GHTreeItem } from '../github-types';
import { DEFAULT_CONFIG } from '../default-config';

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
    // frontmatter connection + derived_from edge
    expect(node.connections.some(c => c.to === 'other')).toBe(true);
    expect(node.connections.some(c => c.type === 'derived_from')).toBe(true);
    expect(node.content).toContain('<h1>');
    expect(node.source).toEqual({ type: 'authored', file: 'content/test.md' });
    expect(node.identity).toBe('urn:content:test-node');
  });

  it('preserves typed relation metadata from authored connections', () => {
    const raw = `---
id: source
title: Source
cluster: engine
connections:
  - to: target
    type: imports
    relation: structural
    description: "Imports target"
    weight: 4
---

Body.`;

    const node = parseMarkdownFile('content/source.md', raw);
    expect(node.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        to: 'target',
        type: 'imports',
        relation: 'structural',
        description: 'Imports target',
        weight: 4,
        source: 'frontmatter',
      }),
    ]));
  });

  it('normalizes authored connection metadata from untrusted YAML values', () => {
    const raw = `---
id: source
title: Source
cluster: engine
connections:
  - to: " target "
    type: " imports "
    relation: " structural "
    description: "Imports target"
    weight: "4"
  - to: fallback
    type: 123
    relation:
      - bad
    weight: "NaN"
  - to: ignored-infinite
    weight: .inf
  - to: 42
    type: imports
---

Body.`;

    const node = parseMarkdownFile('content/source.md', raw);
    expect(node.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        to: 'target',
        type: 'imports',
        relation: 'structural',
        weight: 4,
      }),
      expect.objectContaining({
        to: 'fallback',
        type: 'frontmatter',
      }),
      expect.objectContaining({
        to: 'ignored-infinite',
        type: 'frontmatter',
      }),
    ]));
    const fallback = node.connections.find(c => c.to === 'fallback');
    expect(fallback).not.toHaveProperty('relation');
    expect(fallback).not.toHaveProperty('weight');
    const ignoredInfinite = node.connections.find(c => c.to === 'ignored-infinite');
    expect(ignoredInfinite).not.toHaveProperty('weight');
    expect(node.connections.some(c => c.to === '42')).toBe(false);
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
    // Only connection should be the auto-generated derived_from edge
    expect(node.connections.every(c => c.type === 'derived_from')).toBe(true);
  });

  it('handles missing frontmatter', () => {
    const raw = '# No Frontmatter\n\nPlain markdown.';
    const node = parseMarkdownFile('content/plain.md', raw);
    expect(node.cluster).toBe('default');
    expect(node.rawContent).toContain('# No Frontmatter');
  });

  it('parses per-page accent/tokens/theme frontmatter into node.pageTheme', () => {
    const raw = `---
id: themed
title: Themed Node
cluster: misc
accent: "#C04040"
theme: midnight
tokens:
  colorNeutralBackground1: "#101418"
  borderRadiusMedium: "8px"
---

Body.`;

    const node = parseMarkdownFile('content/themed.md', raw);
    expect(node.pageTheme).toEqual({
      accent: '#C04040',
      theme: 'midnight',
      tokens: {
        colorNeutralBackground1: '#101418',
        borderRadiusMedium: '8px',
      },
    });
  });

  it('parses a partial per-page theme (accent only)', () => {
    const raw = `---
id: accent-only
title: Accent Only
cluster: misc
accent: "#2E86AB"
---

Body.`;
    const node = parseMarkdownFile('content/accent-only.md', raw);
    expect(node.pageTheme).toEqual({ accent: '#2E86AB' });
  });

  it('leaves pageTheme undefined when no theming fields are present', () => {
    const raw = `---
id: plain-node
title: Plain Node
cluster: misc
---

Body.`;
    const node = parseMarkdownFile('content/plain-node.md', raw);
    expect(node.pageTheme).toBeUndefined();
  });

  it('ignores non-string token values and empty token maps in pageTheme', () => {
    const raw = `---
id: messy
title: Messy
cluster: misc
tokens:
  colorNeutralBackground1: "#222"
  bad: 42
---

Body.`;
    const node = parseMarkdownFile('content/messy.md', raw);
    expect(node.pageTheme).toEqual({ tokens: { colorNeutralBackground1: '#222' } });
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

  it('uses the unified `work` cluster regardless of GitHub labels', () => {
    const node = issueToNode(mockIssue);
    expect(node.cluster).toBe('work');
  });

  it('extracts issue cross-references as connections', () => {
    const node = issueToNode(mockIssue);
    expect(node.connections).toHaveLength(2);
    expect(node.connections[0]!.to).toBe('issue-10');
    expect(node.connections[1]!.to).toBe('issue-15');
  });

  it('renders body as HTML', () => {
    const node = issueToNode(mockIssue);
    expect(node.content).toContain('<p>');
  });

  it('handles null body', () => {
    const node = issueToNode({ ...mockIssue, body: null });
    expect(node.rawContent).toContain('OPEN');
    expect(node.rawContent).toContain('View on GitHub');
    expect(node.connections).toEqual([]);
  });

  it('handles no labels and still uses the `work` cluster', () => {
    const node = issueToNode({ ...mockIssue, labels: [] });
    expect(node.cluster).toBe('work');
  });

  it('filters phantom #N refs when knownIssueNumbers is provided', () => {
    const node = issueToNode(mockIssue, {
      knownIssueNumbers: new Set([10]), // #15 doesn't exist in the catalogue
    });
    expect(node.connections.some(c => c.to === 'issue-10')).toBe(true);
    expect(node.connections.some(c => c.to === 'issue-15')).toBe(false);
  });

  it('emits a `tracked-in` edge + parent to the repo node when repoNodeId is set', () => {
    const node = issueToNode(mockIssue, { repoNodeId: 'repo-meta' });
    expect(node.parent).toBe('repo-meta');
    const repoEdge = node.connections.find(c => c.to === 'repo-meta');
    expect(repoEdge).toBeDefined();
    expect(repoEdge!.relation).toBe('tracked-in');
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
