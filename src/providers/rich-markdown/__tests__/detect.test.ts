import { describe, it, expect } from 'vitest';
import { isRichAuthoredMarkdown, readFrontmatterDisplay } from '../detect';

describe('isRichAuthoredMarkdown', () => {
  const withDisplay = (value: string) => `---\nid: x\ntitle: X\ndisplay: ${value}\n---\n# X`;

  it('claims docs that opt in via display: rich-markdown', () => {
    expect(isRichAuthoredMarkdown(withDisplay('rich-markdown'))).toBe(true);
    expect(isRichAuthoredMarkdown(withDisplay('"rich-markdown"'))).toBe(true);
    expect(isRichAuthoredMarkdown(withDisplay("'rich-markdown'"))).toBe(true);
  });

  it('ignores docs with a different (or no) display mode', () => {
    expect(isRichAuthoredMarkdown(withDisplay('prose'))).toBe(false);
    expect(isRichAuthoredMarkdown('---\nid: x\ntitle: X\n---\n# X')).toBe(false);
    expect(isRichAuthoredMarkdown('# No frontmatter')).toBe(false);
  });

  it('does NOT claim plain docs that merely embed a mermaid fence', () => {
    const mermaidDoc = '---\nid: x\ntitle: X\ncluster: engine\n---\n# X\n\n```mermaid\nflowchart TD\nA-->B\n```';
    expect(isRichAuthoredMarkdown(mermaidDoc)).toBe(false);
  });

  it('reads the raw display value', () => {
    expect(readFrontmatterDisplay(withDisplay('code'))).toBe('code');
    expect(readFrontmatterDisplay('no frontmatter')).toBeUndefined();
  });
});
