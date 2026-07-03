/**
 * Minimal access render-gate tests (#445, spec item 4).
 *
 * Core v0.3.0 carries label-only access descriptors (KBAccessLabel); the host
 * enforces. This template's minimal enforcement: labeled-sensitive nodes are
 * withheld from the assembled graph (buildGraph) and from the client-side
 * search index. Absent label = public (unchanged behavior).
 */
import { describe, it, expect } from 'vitest';
import { isAccessWithheld, filterAccessWithheld, parseAccessLabel } from '../access';
import { buildGraph } from '../graph';
import { buildSearchIndex, searchIndex } from '../../search';
import { parseMarkdownFile } from '../parser';
import type { KBAccessLabel, KBNode } from '../../types';

function makeNode(id: string, overrides: Partial<KBNode> = {}): KBNode {
  return {
    id,
    title: `Node ${id}`,
    cluster: 'docs',
    content: `<p>${id} body</p>`,
    rawContent: `# ${id} heading\n\n${id} body searchword${id}`,
    connections: [],
    source: { type: 'authored', file: `${id}.md` },
    ...overrides,
  };
}

const CLUSTERS = [{ id: 'docs', name: 'Docs', color: '#888888' }];

describe('isAccessWithheld', () => {
  it('treats an absent label as public', () => {
    expect(isAccessWithheld(makeNode('a'))).toBe(false);
    expect(isAccessWithheld({ access: undefined })).toBe(false);
  });

  it.each([
    ['restricted'],
    ['confidential'],
    ['unknown'],
    ['RESTRICTED'], // case-insensitive
  ])('withholds classification %s', (classification) => {
    expect(isAccessWithheld({ access: { classification } })).toBe(true);
  });

  it.each([['public'], ['internal'], ['bespoke-scheme']])(
    'renders classification %s (label-only)',
    (classification) => {
      expect(isAccessWithheld({ access: { classification } })).toBe(false);
    },
  );

  it('withholds visibility: private, renders public/internal', () => {
    expect(isAccessWithheld({ access: { visibility: 'private' } })).toBe(true);
    expect(isAccessWithheld({ access: { visibility: 'public' } })).toBe(false);
    expect(isAccessWithheld({ access: { visibility: 'internal' } })).toBe(false);
  });

  it('an empty label object is not withheld (no sensitive marking)', () => {
    expect(isAccessWithheld({ access: {} as KBAccessLabel })).toBe(false);
  });
});

describe('buildGraph — access render-gate', () => {
  it('excludes a restricted-labeled node and its edges from the graph', () => {
    const secret = makeNode('secret', {
      access: { classification: 'restricted' },
    });
    const open = makeNode('open', {
      connections: [{ to: 'secret', description: 'links to secret' }],
    });
    const graph = buildGraph([open, secret], CLUSTERS);

    expect(graph.nodes.map(n => n.id)).toEqual(['open']);
    expect(graph.edges.some(e => e.from === 'secret' || e.to === 'secret')).toBe(false);
    expect(graph.related['secret']).toBeUndefined();
  });

  it('leaves unlabeled (and label-only public) nodes untouched', () => {
    const a = makeNode('a', { connections: [{ to: 'b', description: 'a→b' }] });
    const b = makeNode('b', { access: { classification: 'internal' } });
    const graph = buildGraph([a, b], CLUSTERS);

    expect(graph.nodes.map(n => n.id).sort()).toEqual(['a', 'b']);
    expect(graph.edges.some(e => e.from === 'a' && e.to === 'b')).toBe(true);
    // The label still travels on the rendered node (label-only carriage).
    expect(graph.nodes.find(n => n.id === 'b')?.access?.classification).toBe('internal');
  });
});

describe('filterAccessWithheld', () => {
  it('is identity (same reference) when nothing is labeled sensitive', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    expect(filterAccessWithheld(nodes)).toBe(nodes);
  });
});

describe('search index — access render-gate', () => {
  it('a withheld node is not searchable, even by title', () => {
    const secret = makeNode('secret', {
      title: 'Zephyr Codename',
      access: { classification: 'confidential' },
    });
    const open = makeNode('open');
    const index = buildSearchIndex([open, secret]);

    expect(index.entryMap.has('secret')).toBe(false);
    expect(searchIndex(index, 'zephyr')).toEqual([]);
    expect(searchIndex(index, 'searchwordsecret')).toEqual([]);
  });

  it('unlabeled nodes remain searchable', () => {
    const open = makeNode('open');
    const index = buildSearchIndex([open, makeNode('secret', { access: { visibility: 'private' } })]);
    const hits = searchIndex(index, 'searchwordopen');
    expect(hits.map(h => h.nodeId)).toContain('open');
  });
});

describe('authored frontmatter → access label (end to end)', () => {
  it('parses a frontmatter access label onto the node and the gate withholds it', () => {
    const raw = [
      '---',
      'id: secret-plan',
      'title: Secret Plan',
      'cluster: docs',
      'access:',
      '  classification: restricted',
      '  visibility: private',
      '---',
      '',
      'Top secret body.',
    ].join('\n');
    const node = parseMarkdownFile('content/secret-plan.md', raw);

    expect(node.access).toEqual({ classification: 'restricted', visibility: 'private' });
    const graph = buildGraph([node, makeNode('open')], CLUSTERS);
    expect(graph.nodes.map(n => n.id)).toEqual(['open']);
  });

  it('docs without an access frontmatter stay unlabeled', () => {
    const node = parseMarkdownFile(
      'content/plain.md',
      '---\nid: plain\ntitle: Plain\ncluster: docs\n---\n\nBody.',
    );
    expect(node.access).toBeUndefined();
  });
});

describe('parseAccessLabel — untrusted frontmatter sanitizing', () => {
  it('keeps only well-typed fields', () => {
    expect(
      parseAccessLabel({
        classification: 'restricted',
        visibility: 42,
        labels: ['pii', 7, ''],
        extra: 'dropped',
      }),
    ).toEqual({ classification: 'restricted', labels: ['pii'] });
  });

  it('returns undefined for non-objects and empty labels', () => {
    expect(parseAccessLabel(undefined)).toBeUndefined();
    expect(parseAccessLabel('restricted')).toBeUndefined();
    expect(parseAccessLabel(['restricted'])).toBeUndefined();
    expect(parseAccessLabel({})).toBeUndefined();
    expect(parseAccessLabel({ classification: '  ' })).toBeUndefined();
  });
});
