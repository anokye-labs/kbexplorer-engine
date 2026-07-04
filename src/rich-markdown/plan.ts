/**
 * Prose-fence planning (Wave 0b — #427).
 *
 * Bridges a rendered prose code fence (`<pre><code class="language-X">…`) to a
 * {@link BlockOutput} decision. This is the seam that **replaces the raw-code
 * display** in `ReadingView`'s inline prose walk: Mermaid keeps its existing live
 * path, while any other fence that matches a provider block renders through the
 * block registry (pre-built SVG when available) instead of dumping raw code.
 *
 * Pure (no DOM/React) so it stays node-testable; `ReadingView` applies the
 * decision imperatively to the live prose DOM.
 */
import { getDiagramRenderPlan } from './diagram';
import type { RichMarkdownBlock } from './types';
import { normalizeBlockSource } from './types';
import { ensureBuiltinBlockRenderers } from './renderers';
import { resolveBlockOutput, type BlockOutput } from './registry';

/**
 * Match a rendered prose fence to the provider block it came from.
 *
 * Matching strategy (most → least specific):
 * 1. `hash` equality (when both the fence's expected hash and a block hash are known).
 * 2. Normalized-source equality (whitespace-insensitive; the common path).
 * 3. Same `kind`/language + normalized-source equality (defensive tie-break).
 */
export function findBlockForFence(
  source: string,
  blocks: readonly RichMarkdownBlock[] | undefined,
  options: { language?: string; hash?: string } = {},
): RichMarkdownBlock | undefined {
  if (!blocks || blocks.length === 0) return undefined;

  const { language, hash } = options;
  if (hash) {
    const byHash = blocks.find((b) => b.hash && b.hash === hash);
    if (byHash) return byHash;
  }

  const norm = normalizeBlockSource(source);
  const bySource = blocks.find((b) => normalizeBlockSource(b.source) === norm);
  if (bySource) return bySource;

  if (language) {
    const lang = language.trim().toLowerCase();
    return blocks.find(
      (b) => b.kind.trim().toLowerCase() === lang && normalizeBlockSource(b.source) === norm,
    );
  }
  return undefined;
}

/**
 * Decide how a prose code fence renders.
 *
 * 1. Mermaid (explicit or inferred) keeps its existing **live** path — this is
 *    what preserves back-compat with the current inline-Mermaid behavior.
 * 2. Otherwise, if the fence matches a provider block, resolve it through the
 *    block registry — yielding a pre-built SVG when one exists (the fallback
 *    that replaces today's raw-code display).
 * 3. Otherwise, fall back to the raw source (`unsupported`).
 */
export function planProseFence(
  language: string | undefined,
  source: string,
  blocks?: readonly RichMarkdownBlock[],
  options: { hash?: string; isDark?: boolean } = {},
): BlockOutput {
  ensureBuiltinBlockRenderers();

  const diagram = getDiagramRenderPlan(source, language);
  if (diagram.kind === 'mermaid') {
    return { type: 'mermaid', source: diagram.source };
  }

  const block = findBlockForFence(source, blocks, {
    ...(language !== undefined ? { language } : {}),
    ...(options.hash !== undefined ? { hash: options.hash } : {}),
  });
  if (block) {
    return resolveBlockOutput(block, {
      ...(options.isDark !== undefined ? { isDark: options.isDark } : {}),
    });
  }

  return {
    type: 'unsupported',
    kind: language ?? 'unknown',
    source,
    reason:
      diagram.kind === 'unsupported'
        ? diagram.reason
        : `No renderer for "${language ?? 'unknown'}" and no matching pre-built block.`,
  };
}
