import { describe, it, expect } from 'vitest';
import { buildGraph, getNodeDegrees, getHubNodeId, getEdgeDescription } from '../graph';
import type { KBNode, KBGraph, Cluster, Connection } from '../../types';
import { EDGE_TYPE_WEIGHTS } from '../../types';

// ── Helpers ────────────────────────────────────────────────

function makeNode(id: string, overrides: Partial<KBNode> = {}): KBNode {
  return {
    id,
    title: id,
    cluster: 'default',
    content: '',
    rawContent: '',
    connections: [],
    source: { type: 'authored', file: `content/${id}.md` },
    ...overrides,
  };
}

function conn(to: string, extra: Partial<Connection> = {}): Connection {
  return { to, description: `links to ${to}`, ...extra };
}

const clusters: Cluster[] = [
  { id: 'default', name: 'Default', color: '#ccc' },
  { id: 'engine', name: 'Engine', color: '#f00' },
];

// ── buildGraph ─────────────────────────────────────────────

describe('buildGraph', () => {
  it('produces edges, clusters, and related from connected nodes', () => {
    const nodes = [
      makeNode('a', { connections: [conn('b'), conn('c')] }),
      makeNode('b', { connections: [conn('c')] }),
      makeNode('c'),
    ];
    const graph = buildGraph(nodes, clusters);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.clusters).toBe(clusters);
    // a→b, a→c, b→c
    expect(graph.edges.length).toBe(3);
    expect(graph.related).toBeDefined();
    // 'a' should list b and c as related
    expect(graph.related['a']).toEqual(expect.arrayContaining(['b', 'c']));
  });

  it('connects orphan nodes via inferred edges', () => {
    const nodes = [
      makeNode('hub', { connections: [conn('linked')] }),
      makeNode('linked'),
      makeNode('orphan'),
    ];
    const graph = buildGraph(nodes, clusters);

    // orphan should now have an inferred edge
    const orphanEdge = graph.edges.find(
      e => e.from === 'orphan' || e.to === 'orphan',
    );
    expect(orphanEdge).toBeDefined();
    expect(orphanEdge!.type).toBe('related');
    expect(orphanEdge!.source).toBe('inferred');
  });

  it('connects orphan to same-cluster sibling when available', () => {
    const nodes = [
      makeNode('hub', { cluster: 'engine', connections: [conn('sibling')] }),
      makeNode('sibling', { cluster: 'engine' }),
      makeNode('orphan', { cluster: 'engine' }),
    ];
    const graph = buildGraph(nodes, clusters);

    const orphanEdge = graph.edges.find(e => e.to === 'orphan');
    expect(orphanEdge).toBeDefined();
    // Should connect to a same-cluster sibling, not necessarily the hub
    expect(['hub', 'sibling']).toContain(orphanEdge!.from);
  });

  it('handles empty node list', () => {
    const graph = buildGraph([], clusters);

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.related).toEqual({});
  });

  it('ignores connections to non-existent nodes', () => {
    const nodes = [
      makeNode('a', { connections: [conn('missing')] }),
      makeNode('b', { connections: [conn('a')] }),
    ];
    const graph = buildGraph(nodes, clusters);

    // Only a→b edge exists; 'missing' target is dropped
    const missingEdge = graph.edges.find(e => e.from === 'a' && e.to === 'missing');
    expect(missingEdge).toBeUndefined();
    expect(graph.edges.some(e =>
      (e.from === 'a' && e.to === 'b') || (e.from === 'b' && e.to === 'a'),
    )).toBe(true);
  });
});

// ── buildEdges (tested via buildGraph) ─────────────────────

describe('buildEdges (via buildGraph)', () => {
  it('creates edges with correct type and weight from frontmatter connections', () => {
    const nodes = [
      makeNode('a', {
        connections: [conn('b', { type: 'imports', weight: 4 })],
      }),
      makeNode('b'),
    ];
    const graph = buildGraph(nodes, clusters);
    const edge = graph.edges.find(e => e.from === 'a' && e.to === 'b');

    expect(edge).toBeDefined();
    expect(edge!.type).toBe('imports');
    expect(edge!.weight).toBe(4);
    expect(edge!.source).toBe('frontmatter');
  });

  it('defaults edge type to references and uses EDGE_TYPE_WEIGHTS', () => {
    const nodes = [
      makeNode('a', { connections: [conn('b')] }),
      makeNode('b'),
    ];
    const graph = buildGraph(nodes, clusters);
    const edge = graph.edges.find(e => e.from === 'a' && e.to === 'b');

    expect(edge!.type).toBe('references');
    expect(edge!.weight).toBe(EDGE_TYPE_WEIGHTS.references);
  });

  it('creates parent→child contains edges', () => {
    const nodes = [
      makeNode('parent'),
      makeNode('child', { parent: 'parent' }),
    ];
    const graph = buildGraph(nodes, clusters);
    const edge = graph.edges.find(e => e.type === 'contains');

    expect(edge).toBeDefined();
    expect(edge!.from).toBe('parent');
    expect(edge!.to).toBe('child');
    expect(edge!.weight).toBe(EDGE_TYPE_WEIGHTS.contains);
  });

  it('deduplicates edges between the same pair of nodes', () => {
    const nodes = [
      makeNode('a', { connections: [conn('b')] }),
      makeNode('b', { connections: [conn('a')] }),
    ];
    const graph = buildGraph(nodes, clusters);

    // Only one edge should exist between a and b (canonical key dedup)
    const abEdges = graph.edges.filter(
      e => (e.from === 'a' && e.to === 'b') || (e.from === 'b' && e.to === 'a'),
    );
    expect(abEdges).toHaveLength(1);
  });
});

// ── computeRelated (tested via buildGraph) ─────────────────

describe('computeRelated (via buildGraph)', () => {
  it('returns related node IDs ranked by edge weight', () => {
    const nodes = [
      makeNode('a', {
        connections: [
          conn('b', { type: 'contains', weight: EDGE_TYPE_WEIGHTS.contains }),
          conn('c', { type: 'mentions', weight: EDGE_TYPE_WEIGHTS.mentions }),
        ],
      }),
      makeNode('b'),
      makeNode('c'),
    ];
    const graph = buildGraph(nodes, clusters);

    // 'a' should list b before c (contains=5 > mentions=0.5)
    expect(graph.related['a'][0]).toBe('b');
    expect(graph.related['a'][1]).toBe('c');
  });

  it('caps related list at 12 entries', () => {
    const targets = Array.from({ length: 15 }, (_, i) => makeNode(`n${i}`));
    const connections = targets.map(t => conn(t.id));
    const hub = makeNode('hub', { connections });
    const nodes = [hub, ...targets];
    const graph = buildGraph(nodes, clusters);

    expect(graph.related['hub'].length).toBeLessThanOrEqual(12);
  });
});

// ── getNodeDegrees ─────────────────────────────────────────

describe('getNodeDegrees', () => {
  it('counts connections per node correctly', () => {
    const nodes = [
      makeNode('a', { connections: [conn('b'), conn('c')] }),
      makeNode('b'),
      makeNode('c'),
    ];
    const graph = buildGraph(nodes, clusters);
    const degrees = getNodeDegrees(graph);

    expect(degrees.get('a')).toBe(2); // a→b, a→c
    expect(degrees.get('b')).toBe(1); // from a
    expect(degrees.get('c')).toBe(1); // from a
  });

  it('returns zero for isolated nodes', () => {
    const graph: KBGraph = {
      nodes: [makeNode('lonely')],
      edges: [],
      clusters: [],
      related: {},
    };
    const degrees = getNodeDegrees(graph);
    expect(degrees.get('lonely')).toBe(0);
  });
});

// ── getHubNodeId ───────────────────────────────────────────

describe('getHubNodeId', () => {
  it('prefers readme over everything', () => {
    const graph: KBGraph = {
      nodes: [
        makeNode('readme'),
        makeNode('overview'),
        makeNode('popular', { connections: [conn('readme'), conn('overview')] }),
      ],
      edges: [
        { from: 'popular', to: 'readme', type: 'references', description: '', source: 'frontmatter', weight: 2 },
        { from: 'popular', to: 'overview', type: 'references', description: '', source: 'frontmatter', weight: 2 },
      ],
      clusters: [],
      related: {},
    };
    expect(getHubNodeId(graph)).toBe('readme');
  });

  it('prefers overview when no readme exists', () => {
    const graph: KBGraph = {
      nodes: [makeNode('overview'), makeNode('other')],
      edges: [],
      clusters: [],
      related: {},
    };
    expect(getHubNodeId(graph)).toBe('overview');
  });

  it('falls back to highest-degree node', () => {
    const nodes = [
      makeNode('a', { connections: [conn('b'), conn('c')] }),
      makeNode('b'),
      makeNode('c'),
    ];
    const graph = buildGraph(nodes, clusters);
    expect(getHubNodeId(graph)).toBe('a');
  });

  it('returns null for empty graph', () => {
    const graph: KBGraph = {
      nodes: [],
      edges: [],
      clusters: [],
      related: {},
    };
    expect(getHubNodeId(graph)).toBeNull();
  });
});

// ── getEdgeDescription ─────────────────────────────────────

describe('getEdgeDescription', () => {
  it('finds edge description regardless of direction', () => {
    const graph: KBGraph = {
      nodes: [makeNode('x'), makeNode('y')],
      edges: [
        { from: 'x', to: 'y', type: 'references', description: 'x refs y', source: 'frontmatter', weight: 2 },
      ],
      clusters: [],
      related: {},
    };
    expect(getEdgeDescription(graph, 'x', 'y')).toBe('x refs y');
    expect(getEdgeDescription(graph, 'y', 'x')).toBe('x refs y');
  });

  it('returns undefined when no edge exists', () => {
    const graph: KBGraph = {
      nodes: [makeNode('x'), makeNode('y')],
      edges: [],
      clusters: [],
      related: {},
    };
    expect(getEdgeDescription(graph, 'x', 'y')).toBeUndefined();
  });
});
