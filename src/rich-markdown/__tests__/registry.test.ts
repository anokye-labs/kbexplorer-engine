import { describe, it, expect, afterEach } from 'vitest';
import {
  registerBlockRenderer,
  hasBlockRenderer,
  getBlockRenderer,
  getRegisteredBlockKinds,
  resetBlockRendererRegistry,
  resolveBlockOutput,
  svgFallbackOutput,
} from '../registry';
import {
  registerBuiltinBlockRenderers,
  ensureBuiltinBlockRenderers,
  mermaidBlockRenderer,
} from '../renderers';
import type { RichMarkdownBlock } from '../types';

function block(overrides: Partial<RichMarkdownBlock> & Pick<RichMarkdownBlock, 'kind'>): RichMarkdownBlock {
  return { source: 'SRC', ...overrides };
}

afterEach(() => {
  resetBlockRendererRegistry();
});

describe('block-renderer registry (#427)', () => {
  it('registers, resolves, lists and resets renderers', () => {
    expect(hasBlockRenderer('dot')).toBe(false);
    const r = mermaidBlockRenderer;
    registerBlockRenderer('dot', r);
    expect(hasBlockRenderer('dot')).toBe(true);
    expect(getBlockRenderer('dot')).toBe(r);
    expect(getRegisteredBlockKinds()).toContain('dot');
    resetBlockRendererRegistry();
    expect(getRegisteredBlockKinds()).toHaveLength(0);
  });

  it('rejects empty / whitespace-only keys', () => {
    registerBlockRenderer('   ', mermaidBlockRenderer);
    registerBlockRenderer('', mermaidBlockRenderer);
    expect(getRegisteredBlockKinds()).toHaveLength(0);
  });

  it('matches keys case-insensitively and last registration wins', () => {
    const a = mermaidBlockRenderer;
    const b = mermaidBlockRenderer.bind(null);
    registerBlockRenderer('Canvas', a);
    expect(getBlockRenderer('CANVAS')).toBe(a);
    registerBlockRenderer('canvas', b);
    expect(getBlockRenderer('canvas')).toBe(b);
  });
});

describe('resolveBlockOutput precedence (#427)', () => {
  it('uses a registered renderer when present', () => {
    registerBlockRenderer('mermaid', mermaidBlockRenderer);
    expect(resolveBlockOutput(block({ kind: 'mermaid', source: 'flowchart TD\nA-->B' }))).toEqual({
      type: 'mermaid',
      source: 'flowchart TD\nA-->B',
      title: undefined,
    });
  });

  it('falls back to the pre-built SVG for an unregistered kind (universal fallback)', () => {
    const out = resolveBlockOutput(block({ kind: 'totally-unknown', svg: '<svg/>' }));
    expect(out).toEqual({ type: 'svg', svg: '<svg/>', title: undefined });
  });

  it('reports unsupported only when there is neither a renderer nor an SVG', () => {
    const out = resolveBlockOutput(block({ kind: 'totally-unknown' }));
    expect(out.type).toBe('unsupported');
  });

  it('SVG always wins over a registered renderer that reports unsupported', () => {
    // A renderer that perversely returns unsupported even though an SVG exists.
    registerBlockRenderer('weird', () => ({
      type: 'unsupported',
      kind: 'weird',
      source: 'SRC',
      reason: 'nope',
    }));
    const out = resolveBlockOutput(block({ kind: 'weird', svg: '<svg id="x"/>' }));
    expect(out).toEqual({ type: 'svg', svg: '<svg id="x"/>', title: undefined });
  });

  it('svgFallbackOutput ignores blank SVG strings', () => {
    expect(svgFallbackOutput(block({ kind: 'k', svg: '   ' })).type).toBe('unsupported');
  });
});

describe('built-in renderers (#427)', () => {
  it('registers mermaid + dot/graphviz + ics + canvas', () => {
    registerBuiltinBlockRenderers();
    for (const kind of ['mermaid', 'dot', 'graphviz', 'ics', 'ical', 'icalendar', 'canvas']) {
      expect(hasBlockRenderer(kind)).toBe(true);
    }
  });

  it('renders mermaid live, dot/ics/canvas from a pre-built SVG', () => {
    registerBuiltinBlockRenderers();
    expect(resolveBlockOutput(block({ kind: 'mermaid', source: 'graph TD' })).type).toBe('mermaid');
    expect(resolveBlockOutput(block({ kind: 'dot', svg: '<svg id="dot"/>' }))).toMatchObject({ type: 'svg', svg: '<svg id="dot"/>' });
    expect(resolveBlockOutput(block({ kind: 'ics', svg: '<svg id="ics"/>' }))).toMatchObject({ type: 'svg' });
    expect(resolveBlockOutput(block({ kind: 'canvas', svg: '<svg id="c"/>' }))).toMatchObject({ type: 'svg' });
  });

  it('a dot block with no pre-built SVG is unsupported with a kind-specific reason', () => {
    registerBuiltinBlockRenderers();
    const out = resolveBlockOutput(block({ kind: 'dot' }));
    expect(out.type).toBe('unsupported');
    if (out.type !== 'unsupported') throw new Error('expected unsupported');
    expect(out.reason).toMatch(/Graphviz DOT/);
  });

  it('ensureBuiltinBlockRenderers re-registers after a reset (idempotent)', () => {
    ensureBuiltinBlockRenderers();
    expect(hasBlockRenderer('mermaid')).toBe(true);
    resetBlockRendererRegistry();
    expect(hasBlockRenderer('mermaid')).toBe(false);
    ensureBuiltinBlockRenderers();
    expect(hasBlockRenderer('mermaid')).toBe(true);
  });
});
