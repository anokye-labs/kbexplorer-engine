/**
 * `deriveNeeds` — faithful port of kbexplorer-template's
 * `scripts/derive-content.js` (anokye-labs/kbexplorer-engine#19).
 *
 * Reports which `derived: true` catalogue nodes are missing authored content,
 * so a kb-writer agent (or its thin `kbx graph derive` CLI wrapper, landing
 * in a follow-up) knows what to generate. Pure and source-agnostic: the
 * template script reads `content/*.md` off disk itself; this helper instead
 * takes the already-read file contents via {@link CatalogueContentFiles} so
 * it has no filesystem dependency of its own.
 */
import type { Catalogue, CatalogueContentFiles, CatalogueNode } from './types';

/** Matches the template script's exact "is this derived file hand-edited?" check. */
const AUTHORED_FRONTMATTER = /^authored:\s*true/m;

/** The subset of `CatalogueNode` fields `derive-content.js --json` emits per node. */
export interface DeriveNeedsNode {
  id: string;
  title?: string;
  cluster?: string;
  file?: string;
  prompt?: string;
  edgeHints?: string[];
}

export interface DeriveNeedsResult {
  /** Total number of nodes in the catalogue. */
  total: number;
  /** Nodes preserved as-authored (either `authored: true`, or a `derived` node whose content file carries an `authored: true` frontmatter override). */
  authored: number;
  /** Nodes that still need content generation. */
  derived: number;
  nodes: DeriveNeedsNode[];
}

function toDeriveNeedsNode(node: CatalogueNode): DeriveNeedsNode {
  const out: DeriveNeedsNode = { id: node.id };
  if (node.title !== undefined) out.title = node.title;
  if (node.cluster !== undefined) out.cluster = node.cluster;
  if (node.file !== undefined) out.file = node.file;
  if (node.prompt !== undefined) out.prompt = node.prompt;
  if (node.edgeHints !== undefined) out.edgeHints = node.edgeHints;
  return out;
}

/**
 * A node needs generation when it is `derived` and either has no content
 * file yet, or its content file lacks an `authored: true` frontmatter
 * override — matching the template script's `derived.push(...)` /
 * `needsGeneration.push(...)` branches exactly, including the fact that
 * `authored: true` nodes are always treated as authored regardless of
 * whether their content file currently exists.
 */
export function deriveNeeds(catalogue: Catalogue, contentFiles: CatalogueContentFiles): DeriveNeedsResult {
  const nodes = catalogue.nodes ?? [];
  const authored: CatalogueNode[] = [];
  const needsGeneration: CatalogueNode[] = [];

  for (const node of nodes) {
    if (node.authored) {
      authored.push(node);
      continue;
    }

    if (node.derived) {
      const raw = contentFiles[node.id];
      if (raw !== undefined && AUTHORED_FRONTMATTER.test(raw)) {
        authored.push(node);
        continue;
      }
      needsGeneration.push(node);
    }
  }

  return {
    total: nodes.length,
    authored: authored.length,
    derived: needsGeneration.length,
    nodes: needsGeneration.map(toDeriveNeedsNode),
  };
}
