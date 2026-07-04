/**
 * Rich-Markdown node contract (Wave 0b — #427).
 *
 * A rich-Markdown node carries an open `data.richMarkdown` bag emitted by the
 * provider (anokye-labs/kbexplorer-cli#133). It pairs the node's prose
 * (`node.content` / `node.rawContent`) with a list of **embedded blocks** — each
 * a fenced region (`mermaid` / `dot` / `ics` / `canvas` / …) the provider lifts
 * out, hashes, and (for kinds with no live renderer) pre-renders to SVG.
 *
 * These are **data only** — no DOM, no React — so they stay node-testable. The
 * block-renderer registry ({@link ./registry}) turns a block into a render
 * decision; the React/DOM layer turns that decision into pixels.
 */
import type { KBNode } from '@anokye-labs/kbexplorer-core';

/** Character offsets of a block within the original markdown source. */
export interface BlockRange {
  /** Inclusive start offset into the original markdown. */
  start: number;
  /** Exclusive end offset into the original markdown. */
  end: number;
}

/**
 * One embedded block inside a rich-Markdown node.
 *
 * `kind` is an **open** discriminator (`'mermaid' | 'dot' | 'ics' | 'canvas' | …`)
 * so new block kinds need no core change. `svg` is the pre-built-SVG fallback
 * contract: when a kind has no live renderer, the provider ships a rendered SVG
 * so the block never degrades to a raw code dump.
 */
export interface RichMarkdownBlock {
  /** Open block-kind discriminator, e.g. `'mermaid'`, `'dot'`, `'ics'`, `'canvas'`. */
  kind: string;
  /** Verbatim block source (the fenced-code body). */
  source: string;
  /**
   * Content hash of `source` (e.g. `'sha256:…'`). A stable identity used for
   * caching and as a fast-path key when matching a rendered prose fence back to
   * its provider block. Matching also works without it (by normalized source).
   */
  hash?: string;
  /** Character offsets of the block in the original markdown source. */
  range?: BlockRange;
  /**
   * Pre-built SVG markup — the fallback contract for blocks with no live
   * renderer. When present the block renders this SVG instead of raw code.
   */
  svg?: string;
  /** Optional human-facing caption/label for the block. */
  title?: string;
}

/** The structured payload carried on `node.data.richMarkdown`. */
export interface RichMarkdownDocument {
  /** Frontmatter facts surfaced in the structured view. */
  frontmatter?: Record<string, unknown>;
  /** Embedded blocks, in source order. */
  blocks: RichMarkdownBlock[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrow + validate a single raw block into a {@link RichMarkdownBlock}. */
function coerceBlock(raw: unknown): RichMarkdownBlock | null {
  if (!isObject(raw)) return null;
  if (typeof raw.kind !== 'string' || typeof raw.source !== 'string') return null;

  const block: RichMarkdownBlock = { kind: raw.kind, source: raw.source };
  if (typeof raw.hash === 'string') block.hash = raw.hash;
  if (typeof raw.svg === 'string') block.svg = raw.svg;
  if (typeof raw.title === 'string') block.title = raw.title;
  if (
    isObject(raw.range) &&
    typeof raw.range.start === 'number' &&
    typeof raw.range.end === 'number'
  ) {
    block.range = { start: raw.range.start, end: raw.range.end };
  }
  return block;
}

/**
 * Read + validate a node's `data.richMarkdown` into a {@link RichMarkdownDocument}.
 *
 * Returns `null` when the node carries no (valid) rich-Markdown payload, so a
 * caller can cleanly fall back to plain prose rendering. Malformed blocks are
 * skipped rather than throwing — a single bad block must never blank the page.
 */
export function getRichMarkdownDocument(
  node: Pick<KBNode, 'data'>,
): RichMarkdownDocument | null {
  const rm = node.data?.richMarkdown;
  if (!isObject(rm)) return null;

  const rawBlocks = Array.isArray(rm.blocks) ? rm.blocks : [];
  const blocks = rawBlocks
    .map(coerceBlock)
    .filter((b): b is RichMarkdownBlock => b !== null);

  const doc: RichMarkdownDocument = { blocks };
  if (isObject(rm.frontmatter)) doc.frontmatter = rm.frontmatter;
  return doc;
}

/** True when a node carries a valid rich-Markdown payload. */
export function isRichMarkdownNode(node: Pick<KBNode, 'data'>): boolean {
  return getRichMarkdownDocument(node) !== null;
}

/**
 * Normalize a block's source for stable comparison: CRLF → LF, strip trailing
 * per-line whitespace, then trim ends. Lets a rendered prose fence be matched to
 * its provider block regardless of incidental whitespace differences.
 */
export function normalizeBlockSource(source: string): string {
  return source.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

/**
 * Compute a stable content hash of a block's (normalized) source.
 *
 * Uses a dependency-free, synchronous FNV-1a so it works identically in the
 * browser and in node tests. The provider may emit a stronger hash (e.g.
 * `sha256:…`); block matching never depends on the algorithm (it falls back to
 * normalized-source equality), so this stays an honest, illustrative identity.
 */
export function hashBlockSource(source: string): string {
  const normalized = normalizeBlockSource(source);
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
