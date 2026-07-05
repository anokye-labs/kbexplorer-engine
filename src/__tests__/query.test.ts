import { describe, it, expect } from 'vitest';
import type { KBGraph, KBNode, Cluster } from '@anokye-labs/kbexplorer-core';
import { buildGraph } from '../graph';
import {
  getNode,
  findNodes,
  neighbors,
  related,
  subgraph,
  shortestPath,
} from '../query';

// ── Helpers ────────────────────────────────────────────────

function makeNode(id: string, overrides: Partial<KBNode> = {}): KBNode {
  return {
    id,
    title: id.toUpperCase(),
    cluster: 'default',
    content: '',
    rawContent: '',
    connections: [],
    source: { type: 'authored', file: `content/${id}.md` },
    ...overrides,
  };
}

function conn(to: string, extra: Record<string, unknown> = {}): NonNullable<KBNode['connections']>[number] {
  return { to, description: `links to ${to}`, ...extra };
}

const clusters: Cluster[] = [
  { id: 'default', name: 'Default', color: '#ccc' },
  { id: 'engine', name: 'Engine', color: '#f00' },
];

/**
 * Build a small deterministic, fully-connected graph (no orphans, so
 * buildGraph does not auto-link anything to a hub):
 *   a → b (references), a → c (references), b → c (contains), d → a (references).
 * `d` lives in the `engine` cluster; everyone else in `default`.
 */
function fixtureGraph(): KBGraph {
  const nodes = [
    makeNode('a', { connections: [conn('b'), conn('c')] }),
    makeNode('b', { connections: [conn('c', { type: 'contains' })] }),
    makeNode('c'),
    makeNode('d', { cluster: 'engine', connections: [conn('a')] }),
  ];
  return buildGraph(nodes, clusters);
}

// ── getNode ────────────────────────────────────────────────

describe('getNode', () => {
  it('returns the node by id', () => {
    const graph = fixtureGraph();
    expect(getNode(graph, 'a')?.title).toBe('A');
  });

  it('returns undefined for an unknown id', () => {
    expect(getNode(fixtureGraph(), 'nope')).toBeUndefined();
  });
});

// ── findNodes ──────────────────────────────────────────────

describe('findNodes', () => {
  it('filters nodes by predicate, preserving order', () => {
    const graph = fixtureGraph();
    const ids = findNodes(graph, n => n.cluster === 'default').map(n => n.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('returns [] when nothing matches', () => {
    expect(findNodes(fixtureGraph(), () => false)).toEqual([]);
  });
});

// ── neighbors ──────────────────────────────────────────────

describe('neighbors', () => {
  it('returns both-direction neighbors by default, de-duplicated', () => {
    const graph = fixtureGraph();
    const ids = neighbors(graph, 'c').map(n => n.id).sort();
    // c is a target of a→c and b→c
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('honors direction: out only', () => {
    const graph = fixtureGraph();
    const ids = neighbors(graph, 'a', { direction: 'out' }).map(n => n.id).sort();
    expect(ids).toEqual(['b', 'c']);
  });

  it('honors direction: in only', () => {
    const graph = fixtureGraph();
    const ids = neighbors(graph, 'a', { direction: 'in' }).map(n => n.id);
    // only d points at 'a' in the fixture
    expect(ids).toEqual(['d']);
  });

  it('filters by edge type', () => {
    const graph = fixtureGraph();
    const ids = neighbors(graph, 'b', { direction: 'out', edgeType: 'contains' }).map(n => n.id);
    expect(ids).toEqual(['c']);
  });

  it('returns [] for an unknown id', () => {
    expect(neighbors(fixtureGraph(), 'nope')).toEqual([]);
  });
});

// ── related ────────────────────────────────────────────────

describe('related', () => {
  it('resolves the precomputed related index to nodes', () => {
    const graph = fixtureGraph();
    const relatedToA = related(graph, 'a').map(n => n.id);
    expect(relatedToA).toContain('b');
    expect(relatedToA).toContain('c');
    // every result is a real node
    for (const node of related(graph, 'a')) {
      expect(getNode(graph, node.id)).toBeDefined();
    }
  });

  it('skips related ids that no longer resolve to a node', () => {
    const graph = fixtureGraph();
    const patched: KBGraph = { ...graph, related: { a: ['b', 'ghost'] } };
    expect(related(patched, 'a').map(n => n.id)).toEqual(['b']);
  });

  it('returns [] for an unknown id', () => {
    expect(related(fixtureGraph(), 'nope')).toEqual([]);
  });
});

// ── subgraph ───────────────────────────────────────────────

describe('subgraph', () => {
  it('extracts a radius-1 neighborhood by default', () => {
    const graph = fixtureGraph();
    const sub = subgraph(graph, 'b');
    const ids = sub.nodes.map(n => n.id).sort();
    // b's 1-hop neighborhood: a (a→b), c (b→c), plus b itself
    expect(ids).toEqual(['a', 'b', 'c']);
    // edges only between kept nodes
    for (const edge of sub.edges) {
      expect(ids).toContain(edge.from);
      expect(ids).toContain(edge.to);
    }
  });

  it('respects an explicit radius of 0 (seed only)', () => {
    const sub = subgraph(fixtureGraph(), 'a', { radius: 0 });
    expect(sub.nodes.map(n => n.id)).toEqual(['a']);
    expect(sub.edges).toEqual([]);
  });

  it('filters clusters to those actually used and rebuilds related', () => {
    const graph = fixtureGraph();
    const sub = subgraph(graph, 'b', { radius: 1 });
    // a, b, c are all in the default cluster; engine (only d) is excluded
    expect(sub.clusters.map(c => c.id)).toEqual(['default']);
    for (const [nodeId, rel] of Object.entries(sub.related)) {
      expect(sub.nodes.some(n => n.id === nodeId)).toBe(true);
      for (const rid of rel) {
        expect(sub.nodes.some(n => n.id === rid)).toBe(true);
      }
    }
  });

  it('expands multiple hops to reach cross-cluster nodes', () => {
    const graph = fixtureGraph();
    // d → a, so d is reachable from b within 2 hops (b → a → d, undirected)
    const sub = subgraph(graph, 'b', { radius: 2 });
    expect(sub.nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(sub.clusters.map(c => c.id).sort()).toEqual(['default', 'engine']);
  });

  it('accepts multiple seeds and ignores unknown ones', () => {
    const sub = subgraph(fixtureGraph(), ['a', 'ghost'], { radius: 0 });
    expect(sub.nodes.map(n => n.id)).toEqual(['a']);
  });

  it('produces a valid empty graph when all seeds are unknown', () => {
    const sub = subgraph(fixtureGraph(), 'ghost');
    expect(sub).toEqual({ nodes: [], edges: [], clusters: [], related: {} });
  });
});

// ── shortestPath ───────────────────────────────────────────

describe('shortestPath', () => {
  it('finds the shortest path following edges (both directions)', () => {
    const graph = fixtureGraph();
    const path = shortestPath(graph, 'a', 'c');
    expect(path).toEqual(['a', 'c']);
  });

  it('returns a single-element path when from === to', () => {
    expect(shortestPath(fixtureGraph(), 'a', 'a')).toEqual(['a']);
  });

  it('honors direction and returns null when unreachable that way', () => {
    // Directed chain x → y → z (no back edges): z cannot reach x via out-edges.
    const nodes = [
      makeNode('x', { connections: [conn('y')] }),
      makeNode('y', { connections: [conn('z')] }),
      makeNode('z'),
    ];
    const graph = buildGraph(nodes, clusters);
    expect(shortestPath(graph, 'x', 'z', { direction: 'out' })).toEqual(['x', 'y', 'z']);
    expect(shortestPath(graph, 'z', 'x', { direction: 'out' })).toBeNull();
    // undirected traversal can walk back
    expect(shortestPath(graph, 'z', 'x', { direction: 'both' })).toEqual(['z', 'y', 'x']);
  });

  it('returns null for unknown endpoints', () => {
    const graph = fixtureGraph();
    expect(shortestPath(graph, 'a', 'ghost')).toBeNull();
    expect(shortestPath(graph, 'ghost', 'a')).toBeNull();
  });
});
