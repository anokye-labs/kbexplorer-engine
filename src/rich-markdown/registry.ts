/**
 * Block-renderer registry (Wave 0b — #427).
 *
 * Modeled on the viewer registry ({@link ../viewers/registry}): an open seam
 * that maps a block `kind` to a renderer. This is what lets a `mermaid` block
 * render live while a `dot` / `ics` / `canvas` block renders from a pre-built
 * SVG — without editing any core type or render switch. Unknown kinds resolve to
 * the **universal pre-built-SVG fallback**, so a block with an SVG never falls
 * back to a raw code dump.
 *
 * A renderer returns a pure {@link BlockOutput} **decision** (no DOM/React) so
 * the registry stays node-testable; the React/DOM layer turns the decision into
 * an element (live Mermaid SVG, inline pre-built SVG, or a raw-code fallback).
 */
import type { RichMarkdownBlock } from './types';

/**
 * What a block renderer decided to produce.
 *
 * - `mermaid` — hand the source to the live Mermaid path (renders to SVG client-side).
 * - `svg` — inline a pre-built SVG (the fallback contract).
 * - `unsupported` — no live renderer and no SVG; show the raw source as a last resort.
 */
export type BlockOutput =
  | { type: 'mermaid'; source: string; title?: string }
  | { type: 'svg'; svg: string; title?: string }
  | { type: 'unsupported'; kind: string; source: string; reason: string };

/** Context threaded to renderers (e.g. for theme-aware live rendering). */
export interface BlockRenderContext {
  /** Active dark/light flag, for renderers that theme their output. */
  isDark?: boolean;
}

/** A block renderer maps a block to a {@link BlockOutput} decision. */
export type BlockRenderer = (
  block: RichMarkdownBlock,
  ctx?: BlockRenderContext,
) => BlockOutput;

const registry = new Map<string, BlockRenderer>();

function normalizeKey(kind: string): string {
  return kind.trim().toLowerCase();
}

/** Register a renderer for a block `kind`. Last registration wins (override). */
export function registerBlockRenderer(kind: string, renderer: BlockRenderer): void {
  const key = normalizeKey(kind ?? '');
  if (!key) return; // reject empty / whitespace-only keys
  registry.set(key, renderer);
}

/** True if a renderer is registered for the given block `kind`. */
export function hasBlockRenderer(kind: string | undefined | null): boolean {
  if (!kind) return false;
  return registry.has(normalizeKey(kind));
}

/** Resolve the renderer registered for `kind`, or `undefined`. */
export function getBlockRenderer(
  kind: string | undefined | null,
): BlockRenderer | undefined {
  if (!kind) return undefined;
  return registry.get(normalizeKey(kind));
}

/** List the registered block-kind keys. */
export function getRegisteredBlockKinds(): string[] {
  return [...registry.keys()];
}

/** Remove all registered renderers — primarily for tests. */
export function resetBlockRendererRegistry(): void {
  registry.clear();
}

/**
 * The universal pre-built-SVG fallback. Used when no renderer claims a kind, and
 * as a safety net when a registered renderer reports `unsupported` but an SVG is
 * nonetheless available. This is the contract that **replaces the raw-code
 * display**: a block with an SVG always renders the SVG.
 */
export function svgFallbackOutput(block: RichMarkdownBlock): BlockOutput {
  if (typeof block.svg === 'string' && block.svg.trim()) {
    return { type: 'svg', svg: block.svg, title: block.title };
  }
  return {
    type: 'unsupported',
    kind: block.kind,
    source: block.source,
    reason: `No live renderer for "${block.kind}" block and no pre-built SVG was provided.`,
  };
}

/**
 * Resolve a block to its render decision. Precedence:
 *
 * 1. A renderer registered for `block.kind`.
 * 2. The universal pre-built-SVG fallback ({@link svgFallbackOutput}).
 *
 * If a registered renderer reports `unsupported` but the block carries an SVG,
 * the SVG fallback still wins — guaranteeing a block **never** degrades to raw
 * code when an SVG exists, regardless of how a renderer is implemented.
 */
export function resolveBlockOutput(
  block: RichMarkdownBlock,
  ctx?: BlockRenderContext,
): BlockOutput {
  const renderer = getBlockRenderer(block.kind);
  if (renderer) {
    const output = renderer(block, ctx);
    if (output.type === 'unsupported' && typeof block.svg === 'string' && block.svg.trim()) {
      return svgFallbackOutput(block);
    }
    return output;
  }
  return svgFallbackOutput(block);
}
