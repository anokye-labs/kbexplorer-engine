/**
 * Built-in block renderers (Wave 0b — #427).
 *
 * - `mermaid` — the one **live** renderer: it reuses the existing inline-Mermaid
 *   path (the source is handed back to `ReadingView`'s Mermaid renderer, which
 *   produces an SVG client-side).
 * - `dot` / `ics` / `canvas` — kinds with **no live engine yet**: they render
 *   from the provider's pre-built SVG (the fallback contract). Each is a thin,
 *   SVG-preferring renderer so the registry lists them as first-class kinds and
 *   each can carry a kind-specific "no SVG" explanation.
 */
import type { RichMarkdownBlock } from './types';
import {
  registerBlockRenderer,
  hasBlockRenderer,
  type BlockOutput,
  type BlockRenderer,
} from './registry';

/**
 * Live Mermaid renderer — defers actual SVG production to the inline-Mermaid
 * path in `ReadingView`. Reusing that path is an explicit goal of #427.
 */
export const mermaidBlockRenderer: BlockRenderer = (block) => ({
  type: 'mermaid',
  source: block.source,
  title: block.title,
});

/**
 * Build an SVG-preferring renderer for a kind that has no live engine. It emits
 * the pre-built SVG when present, else an `unsupported` decision with a
 * kind-specific reason (which still becomes a raw-code fallback downstream).
 */
function svgPreferringRenderer(label: string): BlockRenderer {
  return (block: RichMarkdownBlock): BlockOutput => {
    if (typeof block.svg === 'string' && block.svg.trim()) {
      return { type: 'svg', svg: block.svg, title: block.title };
    }
    return {
      type: 'unsupported',
      kind: block.kind,
      source: block.source,
      reason: `${label} blocks render from a pre-built SVG, but none was provided for this block.`,
    };
  };
}

/** Graphviz DOT — rendered from a pre-built SVG. */
export const dotBlockRenderer = svgPreferringRenderer('Graphviz DOT');
/** iCalendar (`.ics`) — rendered from a pre-built SVG (e.g. an agenda card). */
export const icsBlockRenderer = svgPreferringRenderer('iCalendar (ics)');
/** Generic drawing canvas — rendered from a pre-built SVG. */
export const canvasBlockRenderer = svgPreferringRenderer('Canvas');

/** The built-in renderers, keyed by block kind (and common aliases). */
const BUILTIN_BLOCK_RENDERERS: Record<string, BlockRenderer> = {
  mermaid: mermaidBlockRenderer,
  dot: dotBlockRenderer,
  graphviz: dotBlockRenderer,
  ics: icsBlockRenderer,
  ical: icsBlockRenderer,
  icalendar: icsBlockRenderer,
  canvas: canvasBlockRenderer,
};

/**
 * Register the built-in block renderers. Idempotent (last registration wins), so
 * it is safe to call repeatedly.
 */
export function registerBuiltinBlockRenderers(): void {
  for (const [kind, renderer] of Object.entries(BUILTIN_BLOCK_RENDERERS)) {
    registerBlockRenderer(kind, renderer);
  }
}

/**
 * Ensure the built-in renderers are registered without clobbering caller
 * overrides on every render. Re-registers after a registry reset (used by the
 * render path so the registry is always populated regardless of import order).
 */
export function ensureBuiltinBlockRenderers(): void {
  if (!hasBlockRenderer('mermaid')) registerBuiltinBlockRenderers();
}
