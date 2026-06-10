import { describe, it, expect, afterEach } from 'vitest';
import {
  registerType,
  resolveType,
  hasType,
  getRegisteredTypes,
  resolveNodeLayer,
  resolveTypeCluster,
  resetNodeTypeRegistry,
} from '../registry';
import type { KBNode } from '../../../types';

function makeNode(overrides: Partial<KBNode> & Pick<KBNode, 'id' | 'source'>): KBNode {
  return {
    title: overrides.id,
    cluster: 'default',
    content: '',
    rawContent: '',
    connections: [],
    ...overrides,
  };
}

afterEach(() => {
  resetNodeTypeRegistry();
});

describe('node-type registry (T1.2/T1.5)', () => {
  it('registers the built-in source types on import', () => {
    expect(hasType('file')).toBe(true);
    expect(hasType('authored')).toBe(true);
    expect(hasType('issue')).toBe(true);
    expect(resolveType('issue')?.layer).toBe('work');
  });

  it('preserves the historical layer mapping for every built-in source', () => {
    const cases: Array<[KBNode['source'], string]> = [
      [{ type: 'file', path: 'a.ts' }, 'file'],
      [{ type: 'external', provider: 'wikipedia' }, 'file'],
      [{ type: 'authored', file: 'content/x.md' }, 'content'],
      [{ type: 'readme' }, 'content'],
      [{ type: 'derived', generator: 'g' }, 'content'],
      [{ type: 'section', parentSource: { type: 'authored', file: 'x.md' } }, 'content'],
      [{ type: 'issue', number: 1, state: 'open', labels: [] }, 'work'],
      [{ type: 'pull_request', number: 2, state: 'open' }, 'work'],
      [{ type: 'commit', sha: 'abc' }, 'work'],
      [{ type: 'branch', name: 'main', protected: true }, 'work'],
      [{ type: 'workflow', path: '.github/workflows/ci.yml' }, 'work'],
      [{ type: 'repository', owner: 'o', repo: 'r' }, 'work'],
    ];
    for (const [source, layer] of cases) {
      expect(resolveNodeLayer(makeNode({ id: 't', source }))).toBe(layer);
    }
  });

  it('resolves entityType layer ahead of source.type', () => {
    registerType({ id: 'person', layer: 'work', cluster: 'org' });
    const node = makeNode({
      id: 'p1',
      entityType: 'person',
      source: { type: 'structured', entityType: 'person' },
    });
    expect(resolveNodeLayer(node)).toBe('work');
  });

  it('falls back to "file" for an unknown source and no entityType', () => {
    const node = makeNode({ id: 'u1', source: { type: 'mystery' } as unknown as KBNode['source'] });
    expect(resolveNodeLayer(node)).toBe('file');
  });

  it('registerType is discoverable via getRegisteredTypes and resolveType', () => {
    registerType({ id: 'team', label: 'Team', layer: 'work', cluster: 'org', relations: ['staffs'] });
    expect(hasType('team')).toBe(true);
    expect(resolveType('team')?.relations).toContain('staffs');
    expect(getRegisteredTypes().some(t => t.id === 'team')).toBe(true);
  });

  it('resolveTypeCluster prefers entityType cluster then source.type cluster', () => {
    registerType({ id: 'person', layer: 'work', cluster: 'people' });
    expect(
      resolveTypeCluster({ entityType: 'person', source: { type: 'structured' } }),
    ).toBe('people');
    expect(
      resolveTypeCluster({ entityType: undefined, source: { type: 'file' } }),
    ).toBeUndefined();
  });

  it('resetNodeTypeRegistry drops custom types but keeps built-ins', () => {
    registerType({ id: 'person', layer: 'work' });
    expect(hasType('person')).toBe(true);
    resetNodeTypeRegistry();
    expect(hasType('person')).toBe(false);
    expect(hasType('file')).toBe(true);
  });
});
