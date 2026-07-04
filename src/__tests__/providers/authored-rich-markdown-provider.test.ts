import { describe, it, expect } from 'vitest';
import { AuthoredRichMarkdownProvider } from '../../providers/authored-rich-markdown-provider';
import { AuthoredProvider } from '../../providers/authored-provider';
import type { KBConfig, KBNode } from '@anokye-labs/kbexplorer-core';
import { DEFAULT_CONFIG } from '../../default-config';

// NOTE (slice 2/5 judgment call, revised): template's `views/rich-markdown` +
// `views/diagram` are a `views/` directory — out of scope for this engine repo per
// #472's disposition table (all React viewers/theme/views stay in template), full
// stop. This provider (authored-rich-markdown-provider.ts) itself imports ZERO
// views modules — its rich-Markdown contract is entirely self-contained:
// `node.data.richMarkdown = { frontmatter, blocks }` (see adaptIngestedNode). The
// tests below assert directly against that provider-owned output shape rather than
// importing the views-layer `isRichMarkdownNode` / `getRichMarkdownDocument` /
// `planProseFence` helpers, which stay in template. See the PR description for the
// full rationale.

/** Provider-owned rich-Markdown block shape (mirrors adaptIngestedNode's output). */
interface TestRichMarkdownBlock {
  kind: string;
  source: string;
  hash?: string;
  range?: { start: number; end: number };
}

/** Provider-owned rich-Markdown payload shape (`node.data.richMarkdown`). */
interface TestRichMarkdownDocument {
  frontmatter?: Record<string, unknown>;
  blocks: TestRichMarkdownBlock[];
}

/** Read `node.data.richMarkdown` without any views-layer helper. */
function richMarkdownDataOf(node: KBNode): TestRichMarkdownDocument | undefined {
  return (node.data as { richMarkdown?: TestRichMarkdownDocument } | undefined)?.richMarkdown;
}

const config: KBConfig = DEFAULT_CONFIG;

const MERMAID_SOURCE = `flowchart LR
  A --> B`;
const DOT_SOURCE = `digraph G {
  build -> test;
}`;

// An authored doc that opts into rich-Markdown and embeds a live (mermaid) and a
// fallback (dot) block.
const richDoc = `---
id: platform
title: Platform Overview
display: rich-markdown
cluster: docs
owner: Team Atlas
tags: [release, ci]
---

# Platform Overview

The platform pipeline embeds a live diagram plus a Graphviz block.

\`\`\`mermaid
${MERMAID_SOURCE}
\`\`\`

\`\`\`dot
${DOT_SOURCE}
\`\`\`
`;

// A plain authored doc (no opt-in) — must be untouched by the rich provider.
const plainDoc = `---
id: intro
title: Introduction
cluster: docs
---

# Introduction

Plain prose, no rich blocks.`;

describe('AuthoredRichMarkdownProvider', () => {
  it('ingests a rich-markdown authored doc into exactly one rich-md node', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);

    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.provider).toBe('authored-rich-markdown');
    expect(node.display).toBe('rich-markdown');
    // The provider's own contract, not a views-layer concern (see note above):
    // exactly the two fenced blocks the fixture declares, nothing more/less.
    const doc = richMarkdownDataOf(node);
    expect(doc).toBeDefined();
    expect(doc!.blocks.map((b) => b.kind).sort()).toEqual(['dot', 'mermaid']);
  });

  it('emits a distinct local id + canonical content identity (#445 / AF-003)', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);

    // `id` is the stable local slug (the frontmatter id), never an address…
    expect(nodes[0]!.id).toBe('platform');
    expect(nodes[0]!.id).not.toMatch(/^[a-z]+:\/\//);
    // …and `identity` is the template's canonical content URN — the SAME value
    // the doc would carry as plain authored content (assignIdentity), so the
    // two providers' representations of one doc share a merge key.
    expect(nodes[0]!.identity).toBe('urn:content:platform');
    expect(nodes[0]!.identity).not.toBe(nodes[0]!.id);
  });

  it('honors the frontmatter cluster (the pure lib ignores it)', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);
    expect(nodes[0]!.cluster).toBe('docs');
  });

  it('surfaces frontmatter facts in the structured richMarkdown payload', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);

    const doc = richMarkdownDataOf(nodes[0]!);
    expect(doc).toBeDefined();
    expect(doc!.frontmatter).toMatchObject({
      title: 'Platform Overview',
      owner: 'Team Atlas',
    });
    expect(doc!.frontmatter!.tags).toEqual(['release', 'ci']);
  });

  it('maps embedded blocks to the provider contract (kind/source/hash)', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);

    const doc = richMarkdownDataOf(nodes[0]!)!;
    expect(doc.blocks.map((b) => b.kind).sort()).toEqual(['dot', 'mermaid']);

    const mermaid = doc.blocks.find((b) => b.kind === 'mermaid')!;
    expect(mermaid.source.trim()).toBe(MERMAID_SOURCE);
    expect(mermaid.hash).toMatch(/^sha256:hex:[0-9a-f]{64}$/);
    expect(mermaid.range).toBeDefined();

    const dot = doc.blocks.find((b) => b.kind === 'dot')!;
    expect(dot.source.trim()).toBe(DOT_SOURCE);
    expect(dot.hash).toMatch(/^sha256:hex:[0-9a-f]{64}$/);
    expect(dot.hash).not.toBe(mermaid.hash);
    expect(dot.range).toBeDefined();
    // The dot fence is declared after the mermaid fence in richDoc, so its
    // source range must start later.
    expect(dot.range!.start).toBeGreaterThan(mermaid.range!.start);
  });

  // DROPPED (not re-expressible against provider output alone): the original
  // 'renders the mermaid block live and the dot block via the fallback seam'
  // case asserted on `planProseFence`'s live-vs-fallback render DECISION —
  // that decision is made entirely by template's views-layer block-renderer
  // registry (`views/rich-markdown/plan.ts` + `registry.ts`), which this
  // provider never calls and whose output this provider never produces. There
  // is no equivalent provider-owned value to assert on in its place, so rather
  // than pad this file with a hollow stand-in, this case is dropped from
  // engine's copy entirely. Flagged for template to re-home as an integration
  // test alongside its shim-swap PR (verifying planProseFence against this
  // provider's real output), so the coverage isn't silently lost.

  it('parses the body into content HTML so prose fences are walkable', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);

    expect(nodes[0]!.content).toContain('<h1');
    expect(nodes[0]!.content).toContain('language-mermaid');
    expect(nodes[0]!.content).toContain('language-dot');
  });

  it('never renders YAML frontmatter as visible prose', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);
    const { content, rawContent } = nodes[0]!;

    // The rendered prose HTML must not leak the frontmatter delimiters or keys.
    expect(content).not.toContain('---');
    expect(content).not.toContain('display: rich-markdown');
    expect(content).not.toMatch(/owner\s*:/);
    expect(content).not.toMatch(/^\s*tags\s*:/m);
    // …and the body it renders from is itself frontmatter-free.
    expect(rawContent).not.toContain('---');
    expect(rawContent).not.toContain('display: rich-markdown');
    // The frontmatter facts are still available on the provider's own output.
    expect(richMarkdownDataOf(nodes[0]!)!.frontmatter).toMatchObject({ owner: 'Team Atlas' });
  });

  it('ignores plain authored docs (no rich opt-in)', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/intro.md': plainDoc });
    const { nodes, edges } = await provider.resolve(config, []);
    expect(nodes).toHaveLength(0);
    expect(edges).toEqual([]);
  });
});

describe('AuthoredProvider × rich-markdown opt-in (no double-emit)', () => {
  it('skips docs the rich provider owns', async () => {
    const provider = new AuthoredProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);
    expect(nodes).toHaveLength(0);
  });

  it('still emits plain docs as before', async () => {
    const provider = new AuthoredProvider({ 'content/intro.md': plainDoc });
    const { nodes } = await provider.resolve(config, []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe('intro');
    expect(nodes[0]!.identity).toBe('urn:content:intro');
  });

  it('partitions a mixed content set across the two providers', async () => {
    const content = {
      'content/org/platform.md': richDoc,
      'content/intro.md': plainDoc,
    };
    const plain = await new AuthoredProvider(content).resolve(config, []);
    const rich = await new AuthoredRichMarkdownProvider(content).resolve(config, []);

    expect(plain.nodes.map((n) => n.id)).toEqual(['intro']);
    expect(rich.nodes).toHaveLength(1);
    expect(rich.nodes[0]!.display).toBe('rich-markdown');
  });
});
