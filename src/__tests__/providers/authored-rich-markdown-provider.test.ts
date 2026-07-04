import { describe, it, expect } from 'vitest';
import { AuthoredRichMarkdownProvider } from '../../providers/authored-rich-markdown-provider';
import { AuthoredProvider } from '../../providers/authored-provider';
import type { KBConfig } from '@anokye-labs/kbexplorer-core';
import { DEFAULT_CONFIG } from '../../default-config';

// NOTE (slice 2/5 judgment call): template's `views/rich-markdown` + `views/diagram`
// pure-logic modules (isRichMarkdownNode/getRichMarkdownDocument/planProseFence) are
// NOT part of this slice's file list. Assertions/tests that depended on them have
// been trimmed below rather than pulling those view modules in out-of-scope; see the
// PR description for the full rationale and the 5 affected cases.

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
    // (trimmed: isRichMarkdownNode(node) — see slice-2 rich-markdown view-module note above)
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

  // (trimmed: 'surfaces frontmatter facts in the structured view payload' — entirely
  // dependent on getRichMarkdownDocument; see slice-2 rich-markdown view-module note above)

  // (trimmed: 'maps embedded blocks to the template contract (kind/source/hash)' —
  // entirely dependent on getRichMarkdownDocument; see slice-2 rich-markdown view-module
  // note above)

  // (trimmed: 'renders the mermaid block live and the dot block via the fallback seam' —
  // entirely dependent on planProseFence/getRichMarkdownDocument; see slice-2
  // rich-markdown view-module note above)

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
    // (trimmed: frontmatter-facts-via-getRichMarkdownDocument assertion — see
    // slice-2 rich-markdown view-module note above)
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
