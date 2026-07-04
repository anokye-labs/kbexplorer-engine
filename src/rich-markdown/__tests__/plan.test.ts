import { describe, it, expect } from 'vitest';
import { planProseFence, findBlockForFence } from '../plan';
import { hashBlockSource } from '../types';
import type { RichMarkdownBlock } from '../types';
import { buildSampleBlocks } from '../sample-document';

const dotBlock: RichMarkdownBlock = {
  kind: 'dot',
  source: 'digraph G {\n  a -> b;\n}',
  svg: '<svg id="dot"/>',
  hash: hashBlockSource('digraph G {\n  a -> b;\n}'),
};

describe('findBlockForFence (#427)', () => {
  it('matches by normalized source (whitespace-insensitive)', () => {
    const found = findBlockForFence('digraph G {\n  a -> b;  \n}\n', [dotBlock]);
    expect(found).toBe(dotBlock);
  });

  it('matches by hash when provided', () => {
    const found = findBlockForFence('totally different text', [dotBlock], { hash: dotBlock.hash! });
    expect(found).toBe(dotBlock);
  });

  it('returns undefined when nothing matches and for empty block lists', () => {
    expect(findBlockForFence('no match', [dotBlock])).toBeUndefined();
    expect(findBlockForFence('x', [])).toBeUndefined();
    expect(findBlockForFence('x', undefined)).toBeUndefined();
  });
});

describe('planProseFence (#427)', () => {
  it('keeps the live Mermaid path for explicit and inferred Mermaid fences', () => {
    expect(planProseFence('mermaid', 'flowchart TD\nA-->B').type).toBe('mermaid');
    // inferred — no language, but the source is recognisably Mermaid
    expect(planProseFence(undefined, 'sequenceDiagram\n A->>B: hi').type).toBe('mermaid');
  });

  it('renders a matched non-Mermaid block via its pre-built SVG (not raw code)', () => {
    const out = planProseFence('dot', dotBlock.source, [dotBlock]);
    expect(out).toMatchObject({ type: 'svg', svg: '<svg id="dot"/>' });
  });

  it('falls back to unsupported only when there is no matching block and no live renderer', () => {
    const out = planProseFence('plantuml', '@startuml\nA->B\n@enduml');
    expect(out.type).toBe('unsupported');
  });
});

describe('acceptance — sample document blocks (#427)', () => {
  const blocks = buildSampleBlocks();

  it('renders the Mermaid block live and every SVG-backed block via SVG fallback', () => {
    const byKind = Object.fromEntries(
      blocks.map((b) => [b.kind, planProseFence(b.kind, b.source, blocks)]),
    );
    expect(byKind.mermaid!.type).toBe('mermaid');
    expect(byKind.dot!.type).toBe('svg');
    expect(byKind.ics!.type).toBe('svg');
    expect(byKind.canvas!.type).toBe('svg');
  });

  it('NO block falls back to raw code when an SVG exists', () => {
    for (const b of blocks) {
      const out = planProseFence(b.kind, b.source, blocks);
      if (b.svg) {
        expect(out.type).toBe('svg');
      }
      // Whether live (mermaid) or svg-backed, no sample block is ever raw code.
      expect(out.type).not.toBe('unsupported');
    }
  });
});
