/**
 * Regression: intra-fragment connection targets must be remapped to the
 * normalized local node ids (Devin finding on #452 / rich-markdown provider).
 *
 * AuthoredRichMarkdownProvider.resolve() remaps `fragment.edges` through the
 * old→new `idRemap`, but the main assembly path (orchestrator → buildGraph)
 * DISCARDS provider edges and derives every edge from `node.connections`
 * instead. So if a node's `connections[].to` still names another fragment node
 * by its OLD package-assigned id, `buildGraph`'s `nodeMap.has(conn.to)` misses
 * and the edge is silently dropped. The fix mirrors the edge remap onto each
 * node's connections.
 *
 * The shipped package emits one node per doc with a local `id` already distinct
 * from its `identity`, so `localIdOf` is a no-op and the remap can't be observed
 * against real output. We therefore mock the pure ingest lib to return a
 * multi-node fragment whose package ids are `kg://` addresses that COLLAPSE
 * id === identity — exactly the v0.1.0-pin shape `localIdOf` exists to fix,
 * where the adapted local id (`demo/a`) differs from the package id.
 */
import { describe, it, expect, vi } from 'vitest';

// A two-node fragment: node A links node B by B's OLD package id (`kg://demo/b`).
const FRAGMENT = {
  nodes: [
    {
      id: 'kg://demo/a',
      identity: 'kg://demo/a', // id === identity → localIdOf strips → 'demo/a'
      title: 'Doc A',
      cluster: 'docs',
      rawContent: '# Doc A',
      source: { type: 'authored', file: 'content/a.md' },
      connections: [
        { to: 'kg://demo/b', type: 'references', description: 'A → B', source: 'inline', weight: 1 },
      ],
      data: { richMarkdown: { blocks: [] } },
    },
    {
      id: 'kg://demo/b',
      identity: 'kg://demo/b', // → localIdOf strips → 'demo/b'
      title: 'Doc B',
      cluster: 'docs',
      rawContent: '# Doc B',
      source: { type: 'authored', file: 'content/b.md' },
      connections: [],
      data: { richMarkdown: { blocks: [] } },
    },
  ],
  edges: [
    {
      from: 'kg://demo/a',
      to: 'kg://demo/b',
      type: 'references',
      description: 'A → B',
      source: 'inline',
      weight: 1,
      relation: 'structural',
    },
  ],
};

vi.mock('@anokye-labs/kbexplorer-provider-rich-markdown/lib', () => ({
  // Fresh clone per call so the provider's in-place connection remap can't leak
  // between invocations.
  ingestRichMarkdown: vi.fn(() => structuredClone(FRAGMENT)),
}));

const { AuthoredRichMarkdownProvider } = await import(
  '../../providers/authored-rich-markdown-provider'
);
const { buildGraph } = await import('../../graph');
const { DEFAULT_CONFIG } = await import('../../../types');

describe('AuthoredRichMarkdownProvider — intra-fragment connection remap', () => {
  it('remaps connection targets to local ids so inter-node edges survive assembly', async () => {
    const provider = new AuthoredRichMarkdownProvider({
      // Only needs to opt in (display: rich-markdown); the mocked ingest ignores
      // the body and returns the two-node fragment above.
      'content/a.md': '---\ndisplay: rich-markdown\n---\n# A',
    });

    const { nodes } = await provider.resolve(DEFAULT_CONFIG, []);

    const a = nodes.find(n => n.id === 'demo/a');
    const b = nodes.find(n => n.id === 'demo/b');
    expect(a, 'node A adapted to its local id').toBeDefined();
    expect(b, 'node B adapted to its local id').toBeDefined();

    // The connection target was remapped from the OLD package id to B's local id.
    expect(a!.connections.map(c => c.to)).toContain('demo/b');
    expect(a!.connections.map(c => c.to)).not.toContain('kg://demo/b');

    // …and the connection survives into the assembled graph as a real directed
    // `references` edge (buildGraph keeps only connections whose `to` is a node
    // id). Without the remap this edge is silently dropped.
    const graph = buildGraph(nodes, []);
    expect(
      graph.edges.some(e => e.from === 'demo/a' && e.to === 'demo/b' && e.type === 'references'),
    ).toBe(true);
  });
});
