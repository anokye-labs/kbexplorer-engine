import { describe, it, expect } from 'vitest';
import { ProviderRegistry, type GraphProvider, type ProviderResult } from '../providers';
import type { KBConfig, KBNode } from '../../types';

function stubProvider(
  id: string,
  deps: string[] = [],
): GraphProvider {
  return {
    id,
    name: id,
    dependencies: deps,
    async resolve(_config: KBConfig, _existing: KBNode[]): Promise<ProviderResult> {
      return { nodes: [], edges: [] };
    },
  };
}

describe('ProviderRegistry', () => {
  it('returns providers in registration order when no deps', () => {
    const reg = new ProviderRegistry();
    reg.register(stubProvider('a'));
    reg.register(stubProvider('b'));
    reg.register(stubProvider('c'));

    const ids = reg.getExecutionOrder().map(p => p.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('orders providers so deps run first', () => {
    const reg = new ProviderRegistry();
    reg.register(stubProvider('work', ['files']));
    reg.register(stubProvider('files'));
    reg.register(stubProvider('authored', ['files']));

    const ids = reg.getExecutionOrder().map(p => p.id);
    const filesIdx = ids.indexOf('files');
    const workIdx = ids.indexOf('work');
    const authoredIdx = ids.indexOf('authored');

    expect(filesIdx).toBeLessThan(workIdx);
    expect(filesIdx).toBeLessThan(authoredIdx);
  });

  it('handles circular deps without infinite loop', () => {
    const reg = new ProviderRegistry();
    reg.register(stubProvider('a', ['b']));
    reg.register(stubProvider('b', ['a']));

    // Should return without hanging — visited-set guards against loops
    const ids = reg.getExecutionOrder().map(p => p.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('get returns registered provider or undefined', () => {
    const reg = new ProviderRegistry();
    const p = stubProvider('files');
    reg.register(p);

    expect(reg.get('files')).toBe(p);
    expect(reg.get('nonexistent')).toBeUndefined();
  });
});
