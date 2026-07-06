/**
 * Catalogue-pipeline shapes shared by `deriveNeeds`, `compareContent`, and
 * `enrichFromManifest` (anokye-labs/kbexplorer-engine#19, part of the
 * thin-CLI/fat-engine epic anokye-labs/kbexplorer-template#463).
 *
 * These mirror the `content/catalogue.json` schema consumed by
 * kbexplorer-template's `scripts/derive-content.js`, `scripts/compare-content.js`,
 * and `scripts/enrich-context.js` — the kb-architect/kb-writer authoring
 * pipeline this module ports into the engine, field for field.
 */

/** A single node in `content/catalogue.json`. */
export interface CatalogueNode {
  id: string;
  title?: string;
  cluster?: string;
  file?: string;
  prompt?: string;
  edgeHints?: string[];
  /** Marks hand-written content that must never be regenerated. */
  authored?: boolean;
  /** Marks content the kb-writer agent is expected to generate/regenerate. */
  derived?: boolean;
  /** Catalogue nodes may carry additional fields (e.g. enrichment output); preserved as-is. */
  [key: string]: unknown;
}

/** The `content/catalogue.json` file's top-level shape. */
export interface Catalogue {
  nodes: CatalogueNode[];
  [key: string]: unknown;
}

/**
 * Raw content-file text, keyed by catalogue node `id` (i.e. the contents of
 * `content/${id}.md`), for every content file that currently exists on disk —
 * including files that don't correspond to any catalogue node (needed to
 * detect orphans in {@link compareContent}). Callers own the actual file
 * I/O (reading `content/`); these helpers only reason over what they're handed,
 * keeping them pure and source-agnostic.
 */
export type CatalogueContentFiles = Record<string, string>;
