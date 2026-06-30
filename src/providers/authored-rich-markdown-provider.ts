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
 * Identity is the package's core-v0.1.0 `buildAddress` value (e.g. `kg://…`),
 * carried through verbatim. We never touch the package's fs `.` export, so no
 * `node:fs` enters the SPA bundle (the `node:crypto` / `node:path` that `./lib`
 * imports are aliased to browser shims in `vite.config.ts`).
 *
 * The package's block/node shape differs from the template's rendering contract,
 * so {@link adaptIngestedNode} maps it:
 *   - block `{lang, content, contentHash, span}` → `{kind, source, hash, range}`;
 *   - `data.richMarkdown` → `{ frontmatter, blocks }` (the shape
 *     {@link getRichMarkdownDocument} reads);
 *   - `content` (empty from the pure lib) → `marked.parse(body)`, so the inline
 *     prose-fence walk finds the same `<pre><code class="language-…">` fences.
 */
import { marked } from 'marked';
import {
  ingestRichMarkdown,
  type IngestedNode,
  type IngestedBlock,
} from '@anokye-labs/kbexplorer-provider-rich-markdown/lib';
import type { GraphProvider, ProviderResult } from '../providers';
import type { KBConfig, KBNode, KBEdge } from '../../types';
import type { RichMarkdownBlock } from '../../views/rich-markdown';
import { isRichAuthoredMarkdown } from './rich-markdown/detect';

const PROVIDER_ID = 'authored-rich-markdown';

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
 * Adapt the package's ingested node into a template {@link KBNode} the renderer
 * understands. Preserves identity/connections/jsonld/sourceFile from the package
 * and re-shapes only what the template's rich-Markdown contract requires.
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
    id: ingested.id,
    title: ingested.title,
    cluster,
    // The pure lib leaves `content` empty; render the body exactly as the engine
    // renders any node so ProseContent finds the same fences at runtime.
    content: marked.parse(body, { async: false }) as string,
    rawContent: body,
    display: 'rich-markdown',
    connections: (ingested.connections ?? []) as KBNode['connections'],
    identity: ingested.identity,
    source: ingested.source,
    provider: PROVIDER_ID,
    data: {
      ...frontmatter,
      richMarkdown: { frontmatter, blocks },
    },
  };

  if (ingested.emoji != null) node.emoji = ingested.emoji;
  if (ingested.parent != null) node.parent = ingested.parent;
  if (ingested.entityType != null) node.entityType = ingested.entityType;
  if (ingested.jsonld != null) node.jsonld = ingested.jsonld as KBNode['jsonld'];
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
        for (const ingested of fragment.nodes) {
          nodes.push(adaptIngestedNode(ingested));
        }
        for (const edge of fragment.edges) {
          edges.push(edge as KBEdge);
        }
      } catch {
        console.warn(`[AuthoredRichMarkdownProvider] Failed to ingest ${path}, skipping`);
      }
    }

    return { nodes, edges };
  }
}
