// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { buildGraph, renderSafeMarkdown } from '../src/index';

describe('jsdom smoke test', () => {
  it('keeps the package importable in a DOM-like environment', () => {
    expect(typeof buildGraph).toBe('function');
    expect(buildGraph([], [])).toEqual({ nodes: [], edges: [], clusters: [], related: {} });
    expect(renderSafeMarkdown('**bold**')).toContain('<strong>');
  });
});
