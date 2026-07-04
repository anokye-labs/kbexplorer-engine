/**
 * Authored Rich-Markdown Provider (#431).
 *
 * Closes the authored→rich-Markdown gap: it runs the published package's PURE,
 * browser-safe ingestion library — `@anokye-labs/kbexplorer-provider-rich-markdown/lib`
 * `ingestRichMarkdown` — over the **inline** authored content the manifest already
 * carries (`authoredContent`: raw `.md` strings; no filesystem). For each doc that
 * opts in via `display: rich-markdown` ({@link isRichAuthoredMarkdown}), it emits a
 * node carrying `data.richMarkdown.blocks` (+ typed edges) so the merged renderer
 * ({@link isRichMarkdownNode} / `RichMarkdownDocumentView`) fires on real content.
 *
 * Identity is normalized to the template's single mechanism (#445): the node
 * `id` is the package's stable local slug and `identity` is assigned via
 * `assignIdentity` (`urn:content:<id>`, exactly like a plain authored doc) —
 * see {@link adaptIngestedNode}. We never touch the package's fs `.` export, so
 * no `node:fs` enters the SPA bundle (the `node:crypto` / `node:path` that
 * `./lib` imports are aliased to browser shims in `vite.config.ts`).
 *
 * The package's block/node shape differs from the template's rendering contract,
 * so {@link adaptIngestedNode} maps it:
 *   - block `{lang, content, contentHash, span}` → `{kind, source, hash, range}`;
 *   - `data.richMarkdown` → `{ frontmatter, blocks }` (the shape
 *     {@link getRichMarkdownDocument} reads);
 *   - `content` (empty from the pure lib) → `marked.parse(body)`, so the inline
 *     prose-fence walk finds the same `<pre><code class="language-…">` fences.
 */
import { renderSafeMarkdown } from '../safe-markdown';
import { stripScheme } from '@anokye-labs/kbexplorer-core';
import {
  ingestRichMarkdown,
  type IngestedNode,
  type IngestedBlock,
} from '@anokye-labs/kbexplorer-provider-rich-markdown/lib';
import type { GraphProvider, ProviderResult } from '../providers';
import type { KBConfig, KBNode, KBEdge } from '@anokye-labs/kbexplorer-core';
import { assignIdentity } from '../identity';
import { isRichAuthoredMarkdown } from './rich-markdown/detect';

const PROVIDER_ID = 'authored-rich-markdown';

interface RichMarkdownBlock {
  kind: string;
  source: string;
  hash?: string;
  range?: { start: number; end: number };
}

/** Leading YAML frontmatter block (`---\n…\n---`), tolerant of a BOM + CRLF. */
const LEADING_FRONTMATTER_RE = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Strip a leading frontmatter block, defensively.
 *
 * The package's `ingestRichMarkdown` already returns a frontmatter-stripped body
 * in `rawContent`, but rendering raw `---`/YAML as visible prose would be an ugly,
 * public-facing defect. This keeps that guarantee local and version-independent:
 * if a future package revision ever left frontmatter in `rawContent`, the prose
 * still never shows it. A no-op for a body that has no leading frontmatter.
 */
function stripLeadingFrontmatter(raw: string): string {
  return raw.replace(LEADING_FRONTMATTER_RE, '');
}

/** Map one ingested block to the template's {@link RichMarkdownBlock} contract. */
function toTemplateBlock(block: IngestedBlock): RichMarkdownBlock {
  const out: RichMarkdownBlock = { kind: block.lang, source: block.content };
  if (typeof block.contentHash === 'string') out.hash = block.contentHash;
  if (block.span && Number.isFinite(block.span.start) && Number.isFinite(block.span.end)) {
    out.range = { start: block.span.start, end: block.span.end };
  }
  return out;
}

/**
 * Recover the stable local node id from an ingested node.
 *
 * Fixed versions of the package (provider repo #4) emit a distinct local slug
 * `id` alongside the canonical `identity` address, so `id` is used verbatim.
 * The v0.1.0 pin collapsed both fields to the same `kg://…` address
 * (#445 / AF-003), so the slug is recovered by stripping the address scheme —
 * `buildAddress` treats the body as opaque, making this an exact inverse for
 * the authority-less addresses the template mints.
 */
function localIdOf(ingested: IngestedNode): string {
  return ingested.id === ingested.identity ? stripScheme(ingested.id) : ingested.id;
}

/**
 * Adapt the package's ingested node into a template {@link KBNode} the renderer
 * understands. Preserves connections/jsonld/sourceFile from the package and
 * re-shapes only what the template's rich-Markdown contract requires.
 *
 * Identity is NOT passed through verbatim (the unreconciled pass-through was
 * #445's AF-003 / audit finding on PR #432): the node's `id` is the stable
 * local slug, and `identity` is assigned by the template's single mechanism
 * (`assignIdentity` — an `authored` source resolves to `urn:content:<id>`), so
 * a doc that opts into rich-Markdown carries exactly the identity it would
 * have had as plain authored content and merges with other representations of
 * the same content. The package's own `kg://` address remains available in the
 * package output; the template does not carry two competing schemes.
 */
export function adaptIngestedNode(ingested: IngestedNode): KBNode {
  const { richMarkdown: pkgRichMarkdown, ...frontmatter } = ingested.data;
  const blocks = (pkgRichMarkdown.blocks ?? []).map(toTemplateBlock);
  // Authored docs declare their cluster in frontmatter; the pure lib ignores it
  // (it uses the passed `cluster` option), so prefer the frontmatter value here.
  const fmCluster = typeof frontmatter.cluster === 'string' ? frontmatter.cluster.trim() : '';
  const cluster = fmCluster || ingested.cluster;
  // Body only — never the YAML frontmatter (see stripLeadingFrontmatter).
  const body = stripLeadingFrontmatter(ingested.rawContent);

  const node: KBNode = {
    id: localIdOf(ingested),
    title: ingested.title,
    cluster,
    // The pure lib leaves `content` empty; render the body exactly as the engine
    // renders any node so ProseContent finds the same fences at runtime.
    content: renderSafeMarkdown(body),
    rawContent: body,
    display: 'rich-markdown',
    connections: (ingested.connections ?? []) as KBNode['connections'],
    source: ingested.source,
    provider: PROVIDER_ID,
    data: {
      ...frontmatter,
      richMarkdown: { frontmatter, blocks },
    },
  };
  const identity = assignIdentity(node);
  if (identity !== undefined) node.identity = identity;

  if (ingested.emoji != null) node.emoji = ingested.emoji;
  if (ingested.parent != null) node.parent = ingested.parent;
  if (ingested.entityType != null) node.entityType = ingested.entityType;
  if (ingested.jsonld != null) {
    // Keep the LD envelope aligned with the node's canonical identity (core
    // contract: an identity address is always reused as the `@id`).
    node.jsonld = {
      ...(ingested.jsonld as NonNullable<KBNode['jsonld']>),
      '@id': node.identity ?? node.id,
    };
  }
  if (ingested.sourceFile != null) node.sourceFile = ingested.sourceFile;

  return node;
}

export class AuthoredRichMarkdownProvider implements GraphProvider {
  id = PROVIDER_ID;
  name = 'Authored Rich-Markdown';
  dependencies: string[] = [];

  private authoredContent: Record<string, string>;

  constructor(authoredContent: Record<string, string>) {
    this.authoredContent = authoredContent;
  }

  async resolve(_config: KBConfig, _existingNodes: KBNode[]): Promise<ProviderResult> {
    const nodes: KBNode[] = [];
    const edges: KBEdge[] = [];

    for (const [path, raw] of Object.entries(this.authoredContent)) {
      if (!isRichAuthoredMarkdown(raw)) continue;
      try {
        const fragment = ingestRichMarkdown({
          content: raw,
          path,
          cluster: 'docs',
          providerId: PROVIDER_ID,
        });
        // Fragment nodes/edges/connections are all rooted at the package's node
        // identifiers; adaptIngestedNode normalizes each node's `id` to a local
        // slug, so every reference to a node must be remapped to that slug or it
        // dangles. Build the full old→new map first (connections/edges may
        // reference nodes that appear later in the fragment), then remap.
        const idRemap = new Map<string, string>();
        const adapted: KBNode[] = [];
        for (const ingested of fragment.nodes) {
          const node = adaptIngestedNode(ingested);
          idRemap.set(ingested.id, node.id);
          adapted.push(node);
        }
        for (const node of adapted) {
          // Remap intra-fragment connection targets, mirroring the edge remap
          // below: a connection whose `to` still names another node by its OLD
          // package id won't match that node's new local id in buildGraph
          // (`nodeMap.has(conn.to)`), so the edge would be silently dropped.
          if (node.connections.length > 0) {
            node.connections = node.connections.map(conn => ({
              ...conn,
              to: idRemap.get(conn.to) ?? conn.to,
            }));
          }
          nodes.push(node);
        }
        for (const edge of fragment.edges) {
          const e = edge as KBEdge;
          edges.push({
            ...e,
            from: idRemap.get(e.from) ?? e.from,
            to: idRemap.get(e.to) ?? e.to,
          });
        }
      } catch {
        console.warn(`[AuthoredRichMarkdownProvider] Failed to ingest ${path}, skipping`);
      }
    }

    return { nodes, edges };
  }
}
