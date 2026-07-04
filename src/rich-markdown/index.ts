/**
 * Public API for the rich-Markdown rendering feature's pure logic (slice 2/5).
 *
 * Import this barrel to read a node's rich-Markdown payload, plan how a prose
 * fence renders, or register/resolve block renderers. The block-renderer
 * registry is the open seam — modeled on the viewer registry — that lets new
 * block kinds (`mermaid` live, `dot` / `ics` / `canvas` via pre-built SVG) be
 * added without editing any core type.
 *
 * This mirrors template's `src/views/rich-markdown/index.ts`, minus the two
 * React components (`FrontmatterFacts`, `RichMarkdownDocumentView`), which are
 * out of scope for this runtime-agnostic engine package.
 *
 * @example
 * ```ts
 * import { getRichMarkdownDocument, planProseFence } from '@anokye-labs/kbexplorer-engine';
 * const doc = getRichMarkdownDocument(node);
 * const output = planProseFence('dot', fenceSource, doc?.blocks); // → { type: 'svg', … }
 * ```
 */
export {
  type BlockRange,
  type RichMarkdownBlock,
  type RichMarkdownDocument,
  getRichMarkdownDocument,
  isRichMarkdownNode,
  normalizeBlockSource,
  hashBlockSource,
} from './types';

export {
  type BlockOutput,
  type BlockRenderContext,
  type BlockRenderer,
  registerBlockRenderer,
  hasBlockRenderer,
  getBlockRenderer,
  getRegisteredBlockKinds,
  resetBlockRendererRegistry,
  resolveBlockOutput,
  svgFallbackOutput,
} from './registry';

export {
  mermaidBlockRenderer,
  dotBlockRenderer,
  icsBlockRenderer,
  canvasBlockRenderer,
  registerBuiltinBlockRenderers,
  ensureBuiltinBlockRenderers,
} from './renderers';

export { findBlockForFence, planProseFence } from './plan';
export { svgToImageDataUri } from './svg';

export {
  type DiagramRenderPlan,
  diagramLanguageFromClassName,
  extractDiagramFence,
  getDiagramRenderPlan,
  isDiagramCodeLanguage,
  isLikelyMermaidSource,
} from './diagram';
