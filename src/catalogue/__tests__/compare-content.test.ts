/**
 * Golden fixture parity test (anokye-labs/kbexplorer-engine#19): asserts
 * `compareContent()`'s structured result reproduces every value
 * kbexplorer-template's `scripts/compare-content.js` reports on the same
 * catalogue/content fixtures.
 *
 * `compare-content.js` has no `--json` mode — it only prints a human report —
 * so `./fixtures/compare-golden.txt` captures the actual script's stdout
 * (`node scripts/compare-content.js`) against a temp copy of
 * `./fixtures/catalogue.json` + `./fixtures/content/`. This test reconstructs
 * the identical report text from `compareContent()`'s structured result using
 * the same formatting the template script uses, then diffs it against the
 * committed golden text — proving the underlying computation matches, not
 * just the shape.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compareContent, type CompareContentResult } from '../compare-content';
import type { Catalogue, CatalogueContentFiles } from '../types';

const FIXTURES_ROOT = join(__dirname, 'fixtures');
const CONTENT_ROOT = join(FIXTURES_ROOT, 'content');

function loadContentFiles(): CatalogueContentFiles {
  const files: CatalogueContentFiles = {};
  for (const name of readdirSync(CONTENT_ROOT)) {
    if (!name.endsWith('.md')) continue;
    files[name.replace(/\.md$/, '')] = readFileSync(join(CONTENT_ROOT, name), 'utf8');
  }
  return files;
}

/** Reproduces `scripts/compare-content.js`'s exact report formatting from a structured result. */
function formatCompareReport(result: CompareContentResult): string {
  const lines: string[] = [];
  lines.push(`[compare] Comparing catalogue (${result.totalNodes} nodes) to content/ (${result.totalContentFiles} files)`);
  lines.push('');
  lines.push('[compare] ── Coverage ──');
  lines.push(`[compare] Authored (preserved):    ${String(result.authoredNodes.length).padStart(2)}`);
  lines.push(`[compare] Derived (current):       ${String(result.derivedCurrent.length).padStart(2)}`);
  lines.push(`[compare] Missing (needs gen):     ${String(result.missingNodes.length).padStart(2)}`);
  lines.push(`[compare] Extra (not in catalogue):${String(result.extraFiles.length).padStart(2)}`);
  for (const n of result.missingNodes) {
    lines.push(`[compare]   ${n.id}: needs generation`);
  }
  for (const id of result.extraFiles) {
    lines.push(`[compare]   ${id}: orphaned from catalogue`);
  }
  lines.push('');
  lines.push('[compare] ── Drift ──');
  lines.push(`[compare] Cluster changes: ${result.clusterChanges.length}`);
  for (const c of result.clusterChanges) {
    lines.push(`[compare]   ${c.id}: ${c.from} → ${c.to}`);
  }
  lines.push(`[compare] Link count changes: ${result.linkDiffs.length} nodes differ by >3 links`);
  for (const d of result.linkDiffs) {
    lines.push(`[compare]   ${d.id}: catalogue=${d.catalogue}, file=${d.file}`);
  }
  return lines.join('\n');
}

const normalize = (text: string): string => text.replace(/\r\n/g, '\n').trim();

describe('compareContent — golden parity with template compare-content.js', () => {
  it('reproduces the committed golden report text', () => {
    const catalogue = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'catalogue.json'), 'utf8')) as Catalogue;
    const golden = readFileSync(join(FIXTURES_ROOT, 'compare-golden.txt'), 'utf8');
    const contentFiles = loadContentFiles();

    const result = compareContent(catalogue, contentFiles);

    expect(normalize(formatCompareReport(result))).toBe(normalize(golden));
  });

  it('matches the hand-verified structured breakdown', () => {
    const catalogue = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'catalogue.json'), 'utf8')) as Catalogue;
    const contentFiles = loadContentFiles();

    const result = compareContent(catalogue, contentFiles);

    expect(result.totalNodes).toBe(7);
    expect(result.totalContentFiles).toBe(6);
    expect(result.authoredNodes.map(n => n.id)).toEqual(['overview']);
    expect(result.derivedCurrent.map(n => n.id)).toEqual(['api-guide', 'faq', 'cluster-drift', 'link-diff']);
    expect(result.missingNodes.map(n => n.id)).toEqual(['architecture', 'missing-node']);
    expect(result.extraFiles).toEqual(['orphan']);
    expect(result.clusterChanges).toEqual([{ id: 'cluster-drift', from: 'core', to: 'reference' }]);
    expect(result.linkDiffs).toEqual([{ id: 'link-diff', catalogue: 4, file: 0 }]);
  });
});

describe('compareContent — unit behavior', () => {
  it('returns zeroed totals for an empty catalogue and no content files', () => {
    const result = compareContent({ nodes: [] }, {});
    expect(result).toEqual({
      totalNodes: 0,
      totalContentFiles: 0,
      authoredNodes: [],
      derivedCurrent: [],
      missingNodes: [],
      extraFiles: [],
      clusterChanges: [],
      linkDiffs: [],
    });
  });

  it('excludes a "catalogue" id from extraFiles even if present in contentFiles', () => {
    const result = compareContent({ nodes: [] }, { catalogue: '{}' });
    expect(result.extraFiles).toEqual([]);
  });
});
