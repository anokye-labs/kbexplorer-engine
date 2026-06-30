/**
 * Inert rendering of untrusted SVG (Wave 0b — #427, security hardening).
 *
 * A pre-built fallback `block.svg` is **provider/source-supplied (untrusted)**:
 * it may carry active content — event-handler attributes (`onload`, `onclick`,
 * …), `javascript:` URLs in `href`/`xlink:href`, `<script>`, `<foreignObject>`
 * (arbitrary HTML), external `<use>`/`<image>` references, `<style>`. Parsing it
 * and inserting it into the live DOM would be an XSS sink.
 *
 * Instead we encode the SVG into a `data:image/svg+xml` URL and render it via an
 * `<img>`. The browser loads SVG referenced by `<img>` in **secure static mode**:
 * no scripts run, no event handlers fire, no external resources load, and there
 * is no interactivity. The SVG is therefore inert regardless of its contents —
 * no allow/deny list to keep in sync, no parser-differential bypass surface.
 */

/** Base64-encode UTF-8 text. `btoa` + `TextEncoder` are available in browsers
 * and in the node test runtime, so this is portable across both. */
function base64Utf8(text: string): string {
  // UTF-8 bytes → Latin1 binary string → base64 (handles non-ASCII safely).
  const utf8 = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Encode an (untrusted) SVG string into an inert `data:image/svg+xml` URL for an
 * `<img src>`. The markup is embedded verbatim but, loaded as an image, cannot
 * execute script or fetch external resources — see the module header.
 */
export function svgToImageDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${base64Utf8(svg.trim())}`;
}
