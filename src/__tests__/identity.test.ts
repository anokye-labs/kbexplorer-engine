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
