// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { loadKnowledgeBase, providers } from '../src/index';

describe('jsdom smoke test', () => {
  it('keeps the package importable in a DOM-like environment', async () => {
    expect(typeof loadKnowledgeBase).toBe('function');
    expect(providers).toBeDefined();

    await expect(loadKnowledgeBase()).rejects.toThrow('Not implemented yet: loadKnowledgeBase');
  });
});
