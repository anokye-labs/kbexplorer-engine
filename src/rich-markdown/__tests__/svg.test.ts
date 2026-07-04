import { describe, it, expect } from 'vitest';
import { svgToImageDataUri } from '../svg';
import { SAMPLE_DOT_SVG } from '../sample-document';

function decode(dataUri: string): string {
  const match = dataUri.match(/^data:image\/svg\+xml;base64,(.*)$/);
  if (!match) throw new Error(`not an svg data URI: ${dataUri.slice(0, 40)}…`);
  return Buffer.from(match[1], 'base64').toString('utf8');
}

describe('svgToImageDataUri — untrusted SVG is rendered inert (#427 security)', () => {
  it('encodes SVG as a data:image/svg+xml URL (consumed by an inert <img>)', () => {
    const uri = svgToImageDataUri(SAMPLE_DOT_SVG);
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(decode(uri)).toBe(SAMPLE_DOT_SVG.trim());
  });

  it('neutralizes hostile active content — encoded as image payload, never live markup', () => {
    const hostile = [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
      '  <script>alert(2)</script>',
      '  <a href="javascript:alert(3)"><text>x</text></a>',
      '  <foreignObject><iframe src="javascript:alert(4)"></iframe></foreignObject>',
      '  <image href="http://evil.example/x.svg"/>',
      '  <use href="http://evil.example/x.svg#y"/>',
      '  <style>* { background: url(http://evil.example/leak) }</style>',
      '</svg>',
    ].join('\n');

    const uri = svgToImageDataUri(hostile);

    // It is a data:image/svg+xml URL — the consumer renders it via <img src>,
    // where SVG loads in secure static mode (no scripts/handlers, no external
    // fetches, no interactivity), so the markup is inert regardless of contents.
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);

    // None of the active-content vectors appear as live/executable markup in the
    // URL — they are base64-encoded payload, never injected into the live DOM.
    for (const token of ['<script', 'onload=', 'javascript:', '<foreignObject', '<iframe', '<use']) {
      expect(uri).not.toContain(token);
    }

    // …and the payload round-trips intact (content is preserved, not corrupted).
    expect(decode(uri)).toContain('<script>alert(2)</script>');
  });

  it('handles unicode content without throwing', () => {
    const uri = svgToImageDataUri('<svg><text>café — 数据 — ✅</text></svg>');
    expect(decode(uri)).toContain('café — 数据 — ✅');
  });
});
