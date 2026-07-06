/**
 * Unit tests for `validateGraph()` (anokye-labs/kbexplorer-engine#18)
 * covering branches the golden fixture in `./graph-analysis-golden.test.ts`
 * doesn't exercise: the `issueCount > 0` broken-link classification (as
 * opposed to the "no GitHub data" relaxation), a fully clean graph, and the
 * optional-field defaults (`configRaw`/`nodemapRaw`/`tree`/`issues` all
 * omitted).
 */
import { describe, it, expect } from 'vitest';
import { validateGraph } from '../validate-graph';
import type { GHIssue } from '../github-types';

const frontmatter = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

function md(fields: Record<string, string>, body: string): string {
  return `---\n${frontmatter(fields)}\n---\n\n${body}`;
}

describe('validateGraph', () => {
  it('reports zero errors/warnings for a fully clean graph', () => {
    const result = validateGraph({
      authoredContent: {
        'content/home.md': md({ id: 'home', title: 'Home', cluster: 'core' }, 'See [alpha](alpha).'),
        'content/alpha.md': md({ id: 'alpha', title: 'Alpha', cluster: 'core' }, 'Back to [home](home).'),
      },
      configRaw: 'clusters:\n  core:\n    name: Core\n',
    });

    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.summary).toEqual({ contentCount: 2, issueCount: 0 });
  });

  it('classifies issue-*/pr-* links as broken-link errors once GitHub issues exist', () => {
    const result = validateGraph({
      authoredContent: {
        'content/home.md': md({ id: 'home', title: 'Home' }, 'See [issue](issue-1) and [pr](pr-1).'),
      },
      issues: [
        { number: 1, title: 'x', body: null, state: 'open', labels: [], html_url: '', created_at: '', updated_at: '' } satisfies GHIssue,
      ],
    });

    const rules = result.findings.map(f => f.rule);
    expect(rules).toEqual(['broken-inline-link', 'broken-inline-link', 'orphan-node']);
    expect(result.errorCount).toBe(2);
  });

  it('defaults optional fields (configRaw/nodemapRaw/tree/issues) safely when omitted', () => {
    const result = validateGraph({
      authoredContent: {
        'content/home.md': md({ id: 'home', title: 'Home', cluster: 'core' }, 'No links here.'),
      },
    });

    // cluster "core" is undefined (no configRaw) -> invalid-cluster error, plus orphan + empty-ish content is non-empty so no empty-content finding.
    expect(result.findings.map(f => f.rule).sort()).toEqual(['invalid-cluster', 'orphan-node']);
  });

  it('skips nodemap validation entirely when nodemapRaw is absent', () => {
    const result = validateGraph({
      authoredContent: {
        'content/home.md': md({ id: 'home', title: 'Home' }, 'Body.'),
      },
    });
    expect(result.findings.some(f => f.rule === 'missing-nodemap-path')).toBe(false);
  });

  it('flags nodemap.yaml file/directory/files entries that do not resolve to known paths', () => {
    const result = validateGraph({
      authoredContent: {
        'content/home.md': md({ id: 'home', title: 'Home' }, 'Body.'),
      },
      nodemapRaw: [
        'nodes:',
        '  - id: ok-file',
        '    file: content/home.md',
        '  - id: bad-file',
        '    file: content/missing.md',
        '  - id: bad-dir',
        '    directory: does-not-exist',
        '  - id: bad-files',
        '    files:',
        '      - content/home.md',
        '      - content/also-missing.md',
      ].join('\n'),
      tree: [{ path: 'content/home.md', type: 'blob' }],
    });

    const missing = result.findings.filter(f => f.rule === 'missing-nodemap-path').map(f => f.target);
    expect(missing.sort()).toEqual(['content/also-missing.md', 'content/missing.md', 'does-not-exist']);
  });

  it('skips files with no frontmatter id', () => {
    const result = validateGraph({
      authoredContent: {
        'content/no-id.md': '---\ntitle: No Id\n---\n\nBody',
      },
    });
    expect(result.summary.contentCount).toBe(0);
    expect(result.findings).toEqual([]);
  });
});
