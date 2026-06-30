import { describe, it, expect } from 'vitest';
import { AuthoredRichMarkdownProvider } from '../../providers/authored-rich-markdown-provider';
import { AuthoredProvider } from '../../providers/authored-provider';
import type { KBConfig } from '../../../types';
import { DEFAULT_CONFIG } from '../../../types';
import {
  isRichMarkdownNode,
  getRichMarkdownDocument,
  planProseFence,
} from '../../../views/rich-markdown';

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
    const node = nodes[0];
    expect(node.provider).toBe('authored-rich-markdown');
    expect(node.display).toBe('rich-markdown');
    expect(isRichMarkdownNode(node)).toBe(true);
  });

  it('mints a buildAddress identity (opaque core address)', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);

    // core v0.1.0 buildAddress → `<scheme>://…` (default scheme `kg`).
    expect(nodes[0].id).toMatch(/^[a-z]+:\/\//);
    expect(nodes[0].identity).toBe(nodes[0].id);
  });

  it('honors the frontmatter cluster (the pure lib ignores it)', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);
    expect(nodes[0].cluster).toBe('docs');
  });

  it('surfaces frontmatter facts in the structured view payload', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);

    const doc = getRichMarkdownDocument(nodes[0]);
    expect(doc).not.toBeNull();
    expect(doc!.frontmatter).toMatchObject({
      title: 'Platform Overview',
      owner: 'Team Atlas',
    });
    expect(doc!.frontmatter!.tags).toEqual(['release', 'ci']);
  });

  it('maps embedded blocks to the template contract (kind/source/hash)', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);

    const doc = getRichMarkdownDocument(nodes[0])!;
    const kinds = doc.blocks.map((b) => b.kind);
    expect(kinds).toContain('mermaid');
    expect(kinds).toContain('dot');

    const mermaid = doc.blocks.find((b) => b.kind === 'mermaid')!;
    expect(mermaid.source.trim()).toBe(MERMAID_SOURCE);
    expect(mermaid.hash).toMatch(/^sha256:hex:[0-9a-f]{64}$/);
    expect(mermaid.range).toBeDefined();
  });

  it('renders the mermaid block live and the dot block via the fallback seam', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);
    const doc = getRichMarkdownDocument(nodes[0])!;

    // mermaid → live Mermaid path.
    const mermaidPlan = planProseFence('mermaid', MERMAID_SOURCE, doc.blocks);
    expect(mermaidPlan.type).toBe('mermaid');

    // dot → resolves through the block registry; with no provider-supplied SVG
    // it degrades gracefully to the raw-source fallback (never blanks).
    const dotPlan = planProseFence('dot', DOT_SOURCE, doc.blocks);
    expect(dotPlan.type).toBe('unsupported');
    if (dotPlan.type === 'unsupported') {
      expect(dotPlan.source.trim()).toBe(DOT_SOURCE);
    }
  });

  it('parses the body into content HTML so prose fences are walkable', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);

    expect(nodes[0].content).toContain('<h1');
    expect(nodes[0].content).toContain('language-mermaid');
    expect(nodes[0].content).toContain('language-dot');
  });

  it('never renders YAML frontmatter as visible prose', async () => {
    const provider = new AuthoredRichMarkdownProvider({ 'content/org/platform.md': richDoc });
    const { nodes } = await provider.resolve(config, []);
    const { content, rawContent } = nodes[0];

    // The rendered prose HTML must not leak the frontmatter delimiters or keys.
    expect(content).not.toContain('---');
    expect(content).not.toContain('display: rich-markdown');
    expect(content).not.toMatch(/owner\s*:/);
    expect(content).not.toMatch(/^\s*tags\s*:/m);
    // …and the body it renders from is itself frontmatter-free.
    expect(rawContent).not.toContain('---');
    expect(rawContent).not.toContain('display: rich-markdown');
    // The frontmatter facts are still available to the structured view.
    expect(getRichMarkdownDocument(nodes[0])!.frontmatter).toMatchObject({ owner: 'Team Atlas' });
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
    expect(nodes[0].id).toBe('intro');
    expect(nodes[0].identity).toBe('urn:content:intro');
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
    expect(rich.nodes[0].display).toBe('rich-markdown');
  });
});
