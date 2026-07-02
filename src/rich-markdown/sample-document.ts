/**
 * A sample rich-Markdown document + node (Wave 0b — #427).
 *
 * This is the fixture the acceptance criteria describe: a document whose prose
 * embeds a **live Mermaid** block plus `dot` / `ics` / `canvas` blocks that have
 * no live renderer and therefore ship a **pre-built SVG**. It matches the
 * provider shape (`node.data.richMarkdown.blocks`) so this template and the
 * sibling provider (kbexplorer-cli#133) meet on the same contract.
 *
 * Used by:
 *  - the unit tests (asserting no block falls back to raw code when an SVG exists);
 *  - the `?demo=richmd` seam, which injects {@link buildSampleRichMarkdownNode}
 *    into the graph so the document is viewable (and Playwright-verifiable).
 */
import { renderSafeMarkdown } from '../../engine/safe-markdown';
import type { KBNode } from '../../types';
import type { RichMarkdownBlock, RichMarkdownDocument } from './types';
import { hashBlockSource } from './types';

/** Pre-built SVG for the Graphviz DOT block (build → test → deploy). */
export const SAMPLE_DOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80" role="img" aria-label="build to test to deploy">
  <rect x="4" y="24" width="64" height="32" rx="6" fill="#1f6feb"/>
  <text x="36" y="44" fill="#ffffff" font-size="12" text-anchor="middle">build</text>
  <rect x="88" y="24" width="64" height="32" rx="6" fill="#1f6feb"/>
  <text x="120" y="44" fill="#ffffff" font-size="12" text-anchor="middle">test</text>
  <rect x="172" y="24" width="64" height="32" rx="6" fill="#1f6feb"/>
  <text x="204" y="44" fill="#ffffff" font-size="12" text-anchor="middle">deploy</text>
  <line x1="68" y1="40" x2="88" y2="40" stroke="#8b949e" stroke-width="2"/>
  <line x1="152" y1="40" x2="172" y2="40" stroke="#8b949e" stroke-width="2"/>
</svg>`;

/** Pre-built SVG for the iCalendar (`ics`) block (an agenda card). */
export const SAMPLE_ICS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 96" role="img" aria-label="Sprint Review event">
  <rect x="1" y="1" width="238" height="94" rx="8" fill="#161b22" stroke="#30363d"/>
  <rect x="1" y="1" width="238" height="24" rx="8" fill="#a371f7"/>
  <text x="12" y="17" fill="#ffffff" font-size="12" font-weight="bold">Sprint Review</text>
  <text x="12" y="50" fill="#c9d1d9" font-size="11">Jul 1, 2026 · 16:00 UTC</text>
  <text x="12" y="72" fill="#8b949e" font-size="10">iCalendar event</text>
</svg>`;

/** Pre-built SVG for the `canvas` block (a small whiteboard sketch). */
export const SAMPLE_CANVAS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" role="img" aria-label="Canvas whiteboard demo">
  <rect x="0" y="0" width="160" height="100" fill="#0d1117"/>
  <rect x="16" y="16" width="128" height="68" fill="none" stroke="#3fb950" stroke-width="2"/>
  <circle cx="80" cy="48" r="26" fill="#388bfd" opacity="0.8"/>
  <text x="80" y="94" fill="#8b949e" font-size="10" text-anchor="middle">canvas sketch</text>
</svg>`;

const MERMAID_SOURCE = `flowchart LR
  A[Build] --> B[Test]
  B --> C[Deploy]`;

const DOT_SOURCE = `digraph G {
  build -> test;
  test -> deploy;
}`;

const ICS_SOURCE = `BEGIN:VEVENT
SUMMARY:Sprint Review
DTSTART:20260701T160000Z
END:VEVENT`;

const CANVAS_SOURCE = `{ "shapes": [ { "rect": [0, 0, 128, 80] }, { "circle": [80, 48, 26] } ] }`;

/** The document's frontmatter facts (rendered in the structured view). */
export const SAMPLE_FRONTMATTER: Record<string, unknown> = {
  title: 'Release Pipeline',
  status: 'active',
  owner: 'Team Atlas',
  updated: '2026-06-30',
  tags: ['release', 'ci', 'pipeline'],
};

/** The document's prose, in Markdown, with one fenced block per kind. */
export const SAMPLE_RICH_MARKDOWN_RAW = `# Release Pipeline

This document describes the **release pipeline** and embeds several block kinds —
a live diagram plus three blocks that render from a pre-built SVG.

## Flow (live Mermaid)

\`\`\`mermaid
${MERMAID_SOURCE}
\`\`\`

## Dependency graph (Graphviz DOT)

\`\`\`dot
${DOT_SOURCE}
\`\`\`

## Schedule (iCalendar)

\`\`\`ics
${ICS_SOURCE}
\`\`\`

## Whiteboard (canvas)

\`\`\`canvas
${CANVAS_SOURCE}
\`\`\`
`;

/** Build a block, attaching a content hash and the source offsets (range). */
function makeBlock(
  kind: string,
  source: string,
  extra: { svg?: string; title?: string } = {},
): RichMarkdownBlock {
  const start = SAMPLE_RICH_MARKDOWN_RAW.indexOf(source);
  const block: RichMarkdownBlock = { kind, source, hash: hashBlockSource(source) };
  if (start >= 0) block.range = { start, end: start + source.length };
  if (extra.svg) block.svg = extra.svg;
  if (extra.title) block.title = extra.title;
  return block;
}

/** The sample document's embedded blocks, in document order. */
export function buildSampleBlocks(): RichMarkdownBlock[] {
  return [
    makeBlock('mermaid', MERMAID_SOURCE, { title: 'Release flow' }),
    makeBlock('dot', DOT_SOURCE, { svg: SAMPLE_DOT_SVG, title: 'Build dependency graph' }),
    makeBlock('ics', ICS_SOURCE, { svg: SAMPLE_ICS_SVG, title: 'Sprint Review' }),
    makeBlock('canvas', CANVAS_SOURCE, { svg: SAMPLE_CANVAS_SVG, title: 'Whiteboard sketch' }),
  ];
}

/** Build the full {@link RichMarkdownDocument} fixture. */
export function buildSampleRichMarkdownDocument(): RichMarkdownDocument {
  return { frontmatter: SAMPLE_FRONTMATTER, blocks: buildSampleBlocks() };
}

/**
 * Build the sample rich-Markdown {@link KBNode}. `content` is rendered the same
 * way the engine renders any node (`renderSafeMarkdown`), so the inline prose
 * walk finds the same `<pre><code class="language-…">` fences at runtime.
 */
export function buildSampleRichMarkdownNode(id = 'demo-richmd-doc'): KBNode {
  const content = renderSafeMarkdown(SAMPLE_RICH_MARKDOWN_RAW);
  return {
    id,
    title: 'Release Pipeline',
    cluster: 'docs',
    content,
    rawContent: SAMPLE_RICH_MARKDOWN_RAW,
    emoji: 'DocumentRegular',
    display: 'rich-markdown',
    connections: [],
    source: { type: 'derived', generator: 'rich-markdown-demo' },
    provider: 'demo-richmd',
    data: { richMarkdown: buildSampleRichMarkdownDocument() },
  };
}
