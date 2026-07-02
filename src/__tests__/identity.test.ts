import { describe, it, expect } from 'vitest';
import { assignIdentity, shareIdentity, buildIdentityIndex } from '../identity';
import type { KBNode, NodeSource } from '../../types';

// ── Helpers ────────────────────────────────────────────────

function makeNode(
  id: string,
  source: NodeSource,
  identity?: string,
): KBNode {
  return {
    id,
    title: id,
    cluster: 'default',
    content: '',
    rawContent: '',
    connections: [],
    source,
    identity,
  };
}

// ── assignIdentity ─────────────────────────────────────────

describe('assignIdentity', () => {
  it.each([
    ['file',         { type: 'file' as const, path: 'src/main.ts' },                             'urn:file:src/main.ts'],
    ['authored',     { type: 'authored' as const, file: 'content/node.md' },                      'urn:content:my-node'],
    ['readme',       { type: 'readme' as const },                                                  'urn:content:readme'],
    ['issue',        { type: 'issue' as const, number: 42, state: 'open', labels: [] },           'urn:issue:42'],
    ['pull_request', { type: 'pull_request' as const, number: 7, state: 'open' },                 'urn:pr:7'],
    ['commit',       { type: 'commit' as const, sha: 'abc123' },                                  'urn:commit:abc123'],
  ])('returns correct URN for %s source', (_label, source, expected) => {
    const node = makeNode('my-node', source as NodeSource);
    expect(assignIdentity(node)).toBe(expected);
  });

  it('returns undefined for section source', () => {
    const node = makeNode('sec-1', {
      type: 'section',
      parentSource: { type: 'authored', file: 'content/parent.md' },
    });
    expect(assignIdentity(node)).toBeUndefined();
  });
});

// ── external identity is collision-free (injective urnBody) ────
//
// `urn:external:<provider>:<id>` was built by naive string concat
// (`${provider}:${id}`), which is NOT injective: two independently-configured
// providers can mint the same identity when a provider or id contains the `:`
// separator. The cross-provider merge machinery would then silently conflate
// two distinct real-world entities. urnBody percent-encodes each part so the
// composition is injective.
describe('assignIdentity — external identities cannot collide', () => {
  const external = (id: string, provider: string): KBNode =>
    makeNode(id, { type: 'external', provider });

  it('keeps distinct (provider, id) pairs distinct even when a part contains ":"', () => {
    // Naive `${provider}:${id}` collapsed BOTH of these to `urn:external:a:b:c`.
    const collideA = assignIdentity(external('b:c', 'a')); // provider 'a',   id 'b:c'
    const collideB = assignIdentity(external('c', 'a:b')); // provider 'a:b', id 'c'

    expect(collideA).toBe('urn:external:a:b%3Ac');
    expect(collideB).toBe('urn:external:a%3Ab:c');
    expect(collideA).not.toBe(collideB);
  });

  it('leaves a normal (provider, id) pair byte-identical (no churn)', () => {
    expect(assignIdentity(external('wiki-knowledge-graph', 'wikipedia-reference'))).toBe(
      'urn:external:wikipedia-reference:wiki-knowledge-graph',
    );
    expect(assignIdentity(external('org-ceo', 'orgchart-team'))).toBe(
      'urn:external:orgchart-team:org-ceo',
    );
  });
});

// ── shareIdentity ──────────────────────────────────────────

describe('shareIdentity', () => {
  it('returns true when both nodes share the same identity', () => {
    const a = makeNode('a', { type: 'authored', file: 'a.md' }, 'urn:content:a');
    const b = makeNode('b', { type: 'file', path: 'src/a.ts' }, 'urn:content:a');
    expect(shareIdentity(a, b)).toBe(true);
  });

  it('returns false for different identities', () => {
    const a = makeNode('a', { type: 'authored', file: 'a.md' }, 'urn:content:a');
    const b = makeNode('b', { type: 'authored', file: 'b.md' }, 'urn:content:b');
    expect(shareIdentity(a, b)).toBe(false);
  });

  it('returns false when either identity is missing', () => {
    const a = makeNode('a', { type: 'authored', file: 'a.md' }, 'urn:content:a');
    const b = makeNode('b', { type: 'section', parentSource: { type: 'authored', file: 'b.md' } });
    expect(shareIdentity(a, b)).toBe(false);
    expect(shareIdentity(b, a)).toBe(false);
  });
});

// ── buildIdentityIndex ─────────────────────────────────────

describe('buildIdentityIndex', () => {
  it('maps identity URNs to all node IDs sharing them', () => {
    const nodes = [
      makeNode('a', { type: 'authored', file: 'a.md' }, 'urn:content:a'),
      makeNode('b', { type: 'file', path: 'src/a.ts' }, 'urn:content:a'),
      makeNode('c', { type: 'issue', number: 1, state: 'open', labels: [] }, 'urn:issue:1'),
    ];
    const index = buildIdentityIndex(nodes);

    expect(index.get('urn:content:a')).toEqual(['a', 'b']);
    expect(index.get('urn:issue:1')).toEqual(['c']);
  });

  it('skips nodes without identity', () => {
    const nodes = [
      makeNode('a', { type: 'authored', file: 'a.md' }, 'urn:content:a'),
      makeNode('sec', { type: 'section', parentSource: { type: 'authored', file: 'a.md' } }),
    ];
    const index = buildIdentityIndex(nodes);

    expect(index.size).toBe(1);
    expect(index.has('urn:content:a')).toBe(true);
  });
});
