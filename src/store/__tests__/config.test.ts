import { describe, expect, it } from 'vitest';
import { resolveGraphStoreOptions, isGraphStoreEnabled } from '../config';

describe('graph store config', () => {
  it('defaults to disabled', () => {
    expect(resolveGraphStoreOptions({})).toEqual({ mode: 'off' });
    expect(isGraphStoreEnabled({})).toBe(false);
  });

  it('treats off-like values as disabled', () => {
    for (const value of ['off', 'false', '0', '']) {
      expect(resolveGraphStoreOptions({ VITE_KB_GRAPH_STORE: value })).toEqual({ mode: 'off' });
    }
  });

  it('enables sqlite only when explicitly requested', () => {
    expect(resolveGraphStoreOptions({ VITE_KB_GRAPH_STORE: 'sqlite' })).toEqual({ mode: 'sqlite' });
    expect(isGraphStoreEnabled({ VITE_KB_GRAPH_STORE: 'sqlite' })).toBe(true);
  });

  it('rejects unsupported values clearly', () => {
    expect(() => resolveGraphStoreOptions({ VITE_KB_GRAPH_STORE: 'indexeddb' }))
      .toThrow('Unsupported VITE_KB_GRAPH_STORE value');
  });
});
