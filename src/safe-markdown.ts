/**
 * Shared defensive Markdown → HTML renderer (#446 / AF-010).
 *
 * Every node's `content` ends up in the DOM via `dangerouslySetInnerHTML`
 * (ProseContent / ReadingView / SkillView), so ANY markdown a provider renders
 * is an XSS sink for whatever source it came from — GitHub issue/PR/release
 * bodies, README files, authored docs, `.github` templates, structured-content
 * companions. This module is the ONE renderer every engine markdown → HTML path
 * uses, so the defense lives in exactly one place.
 *
 * Approach: **parse, then allowlist-sanitize** (not escape-all). The markdown is
 * rendered to HTML with `marked`, then that HTML is filtered through a strict
 * `sanitize-html` allowlist:
 *
 *  - Safe formatting and *legitimate embedded HTML* render as **live markup** —
 *    `<details>`/`<summary>`, `<img>` badges, `<table>`, GFM task-list
 *    checkboxes, `<picture>`/`<source>` theme-aware images, headings, lists,
 *    fenced code, blockquotes, links. This is the improvement over the previous
 *    escape-all renderer (#446), which turned all embedded HTML into visible
 *    escaped text and broke README/issue/PR content that relies on it.
 *  - Everything not on the allowlist is **escaped** to visible text, never
 *    parsed: `<script>`, `<style>`, `<iframe>`, `<svg>` and friends can never
 *    become live markup.
 *  - `on*` event handlers (`onerror`, `onload`, …) and every attribute not on
 *    the per-tag allowlist are **stripped** — an `<img onerror=…>` keeps the
 *    image but loses the handler.
 *  - Link/image targets are checked *after* HTML-entity, whitespace and
 *    control-char normalization, so entity-encoded scheme colons
 *    (`javascript&colon;`, `javascript&#58;`, `javascript&#x3A;`,
 *    `jav&Tab;ascript:`) are decoded and caught. Only `http`/`https`/`mailto`
 *    and relative targets survive; `javascript:`/`data:`/`vbscript:` (and
 *    dangerous `srcset` candidates) are dropped. Protocol-relative (`//host`)
 *    targets are rejected too.
 *
 * `sanitize-html` is a pure-JavaScript parser (no DOM), so it produces
 * byte-identical output in Node (build/tests/golden generation) and in the
 * browser SPA — the engine runs in both, and the golden fixtures generated in
 * Node therefore faithfully represent what the browser renders.
 */
import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/**
 * Allowlist configuration for {@link renderSafeMarkdown}.
 *
 * `allowedTags` covers everything `marked` (GFM on) can emit — including
 * task-list `<input>` checkboxes — plus the small set of raw-HTML formatting
 * elements that real GitHub/README content uses and that are safe to render
 * live. Anything else is escaped (`disallowedTagsMode: 'escape'`).
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    // Blocks / structure
    'p', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'div', 'span',
    // Inline formatting
    'em', 'strong', 'del',
    'a', 'img',
    // Tables (GFM)
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    // Collapsible sections + theme-aware images (used in real issue/PR/README HTML)
    'details', 'summary', 'picture', 'source',
    // GFM task-list checkboxes are markdown-generated (`- [ ]` / `- [x]`)
    'input',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    source: ['srcset', 'media', 'type', 'sizes'],
    // `start` is markdown-generated for ordered lists that don't begin at 1
    // (`4.` → `<ol start="4">`); `reversed`/`type` are safe presentational
    // siblings. Dropping `start` would silently reset list numbering.
    ol: ['start', 'reversed', 'type'],
    // GFM column alignment renders as `align` on the header/data cells
    // (`|:-:|` → `<th align="center">`); the rest are safe structural/a11y
    // attributes real HTML tables use. All are presentational — no script sink.
    th: ['align', 'colspan', 'rowspan', 'scope'],
    td: ['align', 'colspan', 'rowspan'],
    // Only the attributes marked emits for task-list checkboxes — no `on*`,
    // no `src`/`formaction`, so an allowed `<input>` is inert.
    input: ['type', 'checked', 'disabled'],
    // `class` carries `language-*` on fenced code, which the diagram/mermaid
    // detection and syntax styling read. Kept minimal — no `style`, no `id`.
    code: ['class'],
    pre: ['class'],
    span: ['class'],
    div: ['class'],
  },
  // URL schemes permitted on href/src/srcset after entity + whitespace
  // normalization. Relative targets (no scheme) are always allowed; anything
  // with a `javascript:`/`data:`/`vbscript:`/etc. scheme is dropped.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src', 'srcset'],
  // Reject protocol-relative (`//host/…`) targets — they inherit the page
  // scheme and can point at an arbitrary host.
  allowProtocolRelative: false,
  // Non-allowlisted tags become visible escaped text rather than being dropped,
  // preserving the previous renderer's "hostile markup shows as inert text"
  // property for tags like <script>/<style>/<iframe>/<svg>.
  disallowedTagsMode: 'escape',
};

/** Markdown parser: GFM defaults, matching the engine's prior configuration. */
const markdown = new Marked();

/**
 * Render markdown to HTML with untrusted-content defenses (see module header):
 * `marked.parse` produces HTML, which is then filtered through the allowlist
 * sanitizer. Drop-in replacement for `marked.parse(body, { async: false })`.
 */
export function renderSafeMarkdown(body: string): string {
  const html = markdown.parse(body, { async: false }) as string;
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
