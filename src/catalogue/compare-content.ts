/**
 * `compareContent` — faithful port of kbexplorer-template's
 * `scripts/compare-content.js` (anokye-labs/kbexplorer-engine#19).
 *
 * Compares the catalogue against existing content files and reports coverage
 * (authored / derived / missing / extra) plus drift (cluster changes,
 * link-count changes beyond a threshold of 3). Pure and source-agnostic: the
 * template script reads `content/*.md` itself; this helper instead takes the
 * already-read file contents via {@link CatalogueContentFiles}.
 */
import type { Catalogue, CatalogueContentFiles, CatalogueNode } from './types';

const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const CLUSTER_FRONTMATTER = /^cluster:\s*(.+)$/m;
/** A derived node's link count is flagged when catalogue vs. file differ by more than this. */
const LINK_DIFF_THRESHOLD = 3;

export interface ClusterChange {
  id: string;
  from: string;
  to: string;
}

export interface LinkCountDiff {
  id: string;
  catalogue: number;
  file: number;
}

export interface CompareContentResult {
  totalNodes: number;
  totalContentFiles: number;
  /** `authored: true` nodes whose content file exists (preserved as-is). */
  authoredNodes: CatalogueNode[];
  /** `derived: true` nodes whose content file currently exists. */
  derivedCurrent: CatalogueNode[];
  /** Nodes (authored or derived) whose content file is missing. */
  missingNodes: CatalogueNode[];
  /** Content-file ids that exist on disk but have no matching catalogue node. */
  extraFiles: string[];
  clusterChanges: ClusterChange[];
  linkDiffs: LinkCountDiff[];
}

/**
 * Classifies every catalogue node against the supplied content files and
 * reports coverage + drift, matching `scripts/compare-content.js`'s
 * computation exactly (only its `console.log` report formatting is left out —
 * that's the CLI's job).
 */
export function compareContent(catalogue: Catalogue, contentFiles: CatalogueContentFiles): CompareContentResult {
  const nodes = catalogue.nodes ?? [];
  const contentIds = Object.keys(contentFiles);
  const catalogueIds = new Set<string>();

  const authoredNodes: CatalogueNode[] = [];
  const derivedCurrent: CatalogueNode[] = [];
  const missingNodes: CatalogueNode[] = [];
  const clusterChanges: ClusterChange[] = [];
  const linkDiffs: LinkCountDiff[] = [];

  for (const node of nodes) {
    catalogueIds.add(node.id);
    const raw = contentFiles[node.id];
    const fileExists = raw !== undefined;

    if (node.authored) {
      if (fileExists) {
        authoredNodes.push(node);
      } else {
        missingNodes.push(node);
      }
      continue;
    }

    if (node.derived) {
      if (fileExists) {
        derivedCurrent.push(node);

        const clusterMatch = raw.match(CLUSTER_FRONTMATTER);
        const fileCluster = clusterMatch?.[1]?.trim();
        if (fileCluster !== undefined && fileCluster !== node.cluster) {
          clusterChanges.push({ id: node.id, from: fileCluster, to: String(node.cluster ?? '') });
        }

        const hintCount = (node.edgeHints ?? []).length;
        const linkMatches = raw.match(MARKDOWN_LINK) ?? [];
        const diff = Math.abs(hintCount - linkMatches.length);
        if (diff > LINK_DIFF_THRESHOLD) {
          linkDiffs.push({ id: node.id, catalogue: hintCount, file: linkMatches.length });
        }
      } else {
        missingNodes.push(node);
      }
    }
  }

  // Content files present on disk but absent from the catalogue — orphaned
  // from the authoring pipeline. `catalogue` itself (catalogue.json) is never
  // a content id, matching the template script's explicit exclusion.
  const extraFiles = contentIds.filter(id => !catalogueIds.has(id) && id !== 'catalogue');

  return {
    totalNodes: nodes.length,
    totalContentFiles: contentIds.length,
    authoredNodes,
    derivedCurrent,
    missingNodes,
    extraFiles,
    clusterChanges,
    linkDiffs,
  };
}
