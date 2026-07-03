/**
 * XSS regression tests for the shared defensive markdown renderer
 * (#446 / AF-010 — src/safe-markdown.ts).
 *
 * Every node's `content` reaches the DOM via `dangerouslySetInnerHTML`
 * (ProseContent / ReadingView / SkillView), so each provider path that renders
 * markdown → HTML is an XSS sink for its source. These tests push the canonical
 * payload set through the module itself, asserting that the allowlist sanitizer
 * neutralizes hostile markup — non-allowlisted tags (`<script>`/`<svg>`/`<iframe>`)
 * escape to inert text, `on*` handlers are stripped, and script-executing
 * link/image targets (including entity-encoded scheme colons) are dropped —
 * while legitimate embedded HTML (`<details>`, `<img>` badges, `<table>`)
 * renders as live markup.
 *
 * NOTE (slice 1/5, anokye-labs/kbexplorer-template#472): the original template
 * test also pushed this payload set through every provider path that renders
 * markdown (StructuralProvider, WorkProvider, PersonProvider,
 * AuthoredRichMarkdownProvider, the local-loader manifest pipeline). Those
 * providers/local-loader haven't migrated to this package yet (providers land
 * in slice 2), so that "provider-path regression" describe block stays in
 * kbexplorer-template for now — only the renderSafeMarkdown unit tests below
 * moved here.
 */
import { describe, it, expect } from 'vitest';
import { renderSafeMarkdown } from '../safe-markdown';

// ── Canonical payloads ──────────────────────────────────────

const IMG_ONERROR = '<img src=x onerror=alert(1)>';
const SVG_ONLOAD = '<svg onload=alert(1)></svg>';
const SCRIPT = '<script>alert(1)</script>';
const JS_LINK = '[x](javascript:alert(1))';
// base64 of `<script>alert(1)</script>` — a data: URL that would execute if
// ever emitted as a live href/src.
const DATA_IMAGE = '![x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)';
const VBS_LINK = '[x](vbscript:msgbox(1))';

/**
 * Assert rendered HTML carries none of the payloads as live markup:
 * no live `<script>`/`<svg>`/`onerror` element, and no script-executing
 * URL scheme in any attribute. (Escaped text like `&lt;script&gt;` is the
 * EXPECTED safe representation and deliberately does not trip these.)
 */
function expectSanitized(html: string): void {
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<svg/i);
  expect(html).not.toMatch(/<img[^>]*onerror/i);
  expect(html).not.toMatch(/javascript:/i);
  expect(html).not.toMatch(/vbscript:/i);
  expect(html).not.toMatch(/data:text\/html/i);
}

// ── Module unit tests: security (hostile markup neutralized) ─

describe('renderSafeMarkdown — hostile markup is neutralized', () => {
  it('keeps <img> but strips the onerror handler', () => {
    const html = renderSafeMarkdown(IMG_ONERROR);
    expectSanitized(html);
    // The image element survives (allowlisted) — the event handler is gone.
    expect(html).toMatch(/<img\b/);
    expect(html).not.toMatch(/onerror/i);
  });

  it('keeps a badge <img> with an http(s) src but strips onerror', () => {
    const html = renderSafeMarkdown(
      '<img src="https://img.shields.io/badge/build-passing.svg" onerror="alert(1)" alt="build">',
    );
    expectSanitized(html);
    expect(html).toContain('src="https://img.shields.io/badge/build-passing.svg"');
    expect(html).toContain('alt="build"');
    expect(html).not.toMatch(/onerror/i);
  });

  it('escapes <svg onload> to inert text (tag not allowlisted, handler dropped)', () => {
    const html = renderSafeMarkdown(SVG_ONLOAD);
    expectSanitized(html);
    expect(html).toContain('&lt;svg&gt;');
    expect(html).not.toMatch(/onload/i);
  });

  it('escapes <script> to inert text', () => {
    const html = renderSafeMarkdown(SCRIPT);
    expectSanitized(html);
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes <iframe> to inert text', () => {
    const html = renderSafeMarkdown('<iframe src="https://evil.example"></iframe>');
    expectSanitized(html);
    expect(html).toContain('&lt;iframe&gt;');
  });

  it('defangs javascript: link targets (anchor kept, href dropped)', () => {
    const html = renderSafeMarkdown(JS_LINK);
    expectSanitized(html);
    // The link text still renders, but the dangerous href is gone entirely.
    expect(html).toMatch(/<a>x<\/a>/);
    expect(html).not.toMatch(/href=/);
  });

  it('defangs data: image targets (img kept, src dropped)', () => {
    const html = renderSafeMarkdown(DATA_IMAGE);
    expectSanitized(html);
    expect(html).toMatch(/<img\b/);
    expect(html).not.toMatch(/src=/);
  });

  it('defangs vbscript: link targets', () => {
    const html = renderSafeMarkdown(VBS_LINK);
    expectSanitized(html);
    expect(html).not.toMatch(/href=/);
  });

  // The entity-encoded-colon family — the bypass that an escape-all renderer or
  // a naive `^javascript:` regex misses, but which an allowlist sanitizer
  // normalizes (decodes entities + strips whitespace/control chars) *before*
  // checking the scheme.
  it.each([
    ['&colon; (named entity)', '[x](javascript&colon;alert(1))'],
    ['&#58; (decimal entity)', '[x](javascript&#58;alert(1))'],
    ['&#x3A; (hex entity)', '[x](javascript&#x3A;alert(1))'],
    ['&Tab; (embedded control entity)', '[x](jav&Tab;ascript:alert(1))'],
  ])('neutralizes entity-encoded javascript colon: %s', (_label, md) => {
    const html = renderSafeMarkdown(md);
    expectSanitized(html);
    expect(html).not.toMatch(/href=/);
    // Decoding must not resurrect a live scheme anywhere in the output.
    expect(html).not.toMatch(/javascript/i);
  });
});

// ── Module unit tests: rendering (legit markup survives) ─────

describe('renderSafeMarkdown — legitimate HTML renders as live markup', () => {
  it('renders a <details>/<summary> block as live markup, not escaped text', () => {
    const html = renderSafeMarkdown(
      '<details>\n<summary>More</summary>\n\nHidden **content**.\n\n</details>',
    );
    expect(html).toMatch(/<details>/);
    expect(html).toMatch(/<summary>More<\/summary>/);
    // Markdown inside the block still renders.
    expect(html).toContain('<strong>content</strong>');
    // Not escaped to text.
    expect(html).not.toContain('&lt;details&gt;');
  });

  it('renders a raw <img> badge with an http src as a live image', () => {
    const html = renderSafeMarkdown(
      '<img src="https://img.shields.io/badge/coverage-98%25-green.svg" alt="coverage">',
    );
    expect(html).toMatch(/<img\b[^>]*src="https:\/\/img\.shields\.io/);
    expect(html).toContain('alt="coverage"');
    expect(html).not.toContain('&lt;img');
  });

  it('renders a raw <table> as a live table, not escaped text', () => {
    const html = renderSafeMarkdown(
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>',
    );
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<td>c</td>');
    expect(html).not.toContain('&lt;table&gt;');
  });

  it('leaves markdown-generated markup intact (headings, code, safe links, tables)', () => {
    const html = renderSafeMarkdown(
      '# Title\n\n`code`\n\n[ok](https://example.com)\n\n```js\nconst a = 1;\n```\n\n' +
        '| A | B |\n|---|---|\n| 1 | 2 |',
    );
    expect(html).toContain('<h1');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('language-js');
    expect(html).toContain('<table>');
  });

  it('keeps GFM task-list checkboxes (markdown-generated <input>)', () => {
    const html = renderSafeMarkdown('- [ ] todo\n- [x] done');
    expect(html).toMatch(/<input\b[^>]*type="checkbox"/);
    expect(html).toMatch(/checked/);
  });

  it('renders relative and mailto link targets (allowlisted schemes)', () => {
    const html = renderSafeMarkdown('[rel](/docs/x) and [mail](mailto:a@b.com)');
    expect(html).toContain('href="/docs/x"');
    expect(html).toContain('href="mailto:a@b.com"');
  });
});
