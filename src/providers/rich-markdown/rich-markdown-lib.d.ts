/**
 * Ambient types for the rich-Markdown provider package's pure `./lib` export,
 * which ships as plain JavaScript (no bundled `.d.ts`). We type only the surface
 * the engine consumes: {@link ingestRichMarkdown} and the block/node shapes it
 * returns. The runtime contract is verified by the provider's tests.
 */
declare module '@anokye-labs/kbexplorer-provider-rich-markdown/lib' {
  /** One fenced embedded block, as emitted by `ingestRichMarkdown`. */
  export interface IngestedBlock {
    index: number;
    /** Fenced-code language (`dot` | `mermaid` | `ics` | `canvas`). */
    lang: string;
    info: string;
    /** Verbatim fenced-code body. */
    content: string;
    /** Canonical content hash, e.g. `sha256:hex:…`. */
    contentHash: string;
    /** Document-relative byte offsets of the block. */
    span: { start: number; end: number };
    contentSpan?: { start: number; end: number };
    lines?: { start: number; end: number };
    sourceRef?: unknown;
  }

  /** The one-node graph fragment a single document ingests to. */
  export interface IngestedNode {
    id: string;
    title: string;
    cluster: string;
    content: string;
    rawContent: string;
    connections: unknown[];
    identity: string;
    source: { type: 'authored'; file: string } | { type: 'readme' };
    sourceFile?: { path: string; raw: string; format: 'markdown' };
    display?: string;
    emoji?: string;
    parent?: string;
    provider?: string;
    entityType?: string;
    jsonld?: Record<string, unknown>;
    /** Frontmatter (arbitrary keys) spread in, plus nested `richMarkdown`. */
    data: Record<string, unknown> & {
      richMarkdown: { source?: unknown; blocks: IngestedBlock[]; links?: unknown[] };
    };
  }

  export interface IngestedEdge {
    from: string;
    to: string;
    type: string;
    description: string;
    source: string;
    weight: number;
    relation?: string;
  }

  export interface IngestInput {
    content: string;
    path?: string;
    identity?: { scheme?: string; authority?: string };
    cluster?: string;
    providerId?: string;
    entityType?: string;
  }

  export function ingestRichMarkdown(
    input: IngestInput,
  ): { nodes: IngestedNode[]; edges: IngestedEdge[] };

  export const RICH_MARKDOWN_BLOCK_LANGS: readonly string[];
  export function parseRichFrontmatter(raw: string): {
    ok: boolean;
    frontmatter: Record<string, unknown>;
    body: string;
    raw: string;
    bodyOffset: number;
  };
}
