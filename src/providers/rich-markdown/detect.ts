/**
 * Shared discriminator for authored rich-Markdown docs.
 *
 * A doc opts **in** to rich-Markdown ingestion by declaring `display:
 * rich-markdown` in its YAML frontmatter. This explicit flag (rather than
 * auto-detecting fenced `dot`/`mermaid`/`ics`/`canvas` blocks) is deliberate: it
 * leaves existing authored docs that merely embed a Mermaid diagram — and render
 * via the plain prose path — completely untouched, with no change to their id,
 * identity, or display. Only docs that ask for it flow through
 * {@link AuthoredRichMarkdownProvider}.
 *
 * Used by BOTH {@link AuthoredRichMarkdownProvider} (to claim a doc) and
 * {@link AuthoredProvider} (to skip it), so a rich doc is owned by exactly one
 * provider and never emitted twice.
 */

const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const DISPLAY_RE = /^\s*display\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/m;

/** Read the `display` value from a doc's YAML frontmatter, or `undefined`. */
export function readFrontmatterDisplay(raw: string): string | undefined {
  const fm = FRONTMATTER_RE.exec(raw);
  if (!fm) return undefined;
  const m = DISPLAY_RE.exec(fm[1]);
  if (!m) return undefined;
  const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
  return value || undefined;
}

/** True when an authored doc opts into rich-Markdown ingestion. */
export function isRichAuthoredMarkdown(raw: string): boolean {
  return readFrontmatterDisplay(raw) === 'rich-markdown';
}
