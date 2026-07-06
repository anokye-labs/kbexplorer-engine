/**
 * Golden fixture parity test (anokye-labs/kbexplorer-engine#19): asserts
 * `deriveNeeds()` reproduces kbexplorer-template's `scripts/derive-content.js
 * --json` output byte-for-byte on the same catalogue/content fixtures.
 *
 * `./fixtures/derive-golden.json` was captured by running the actual
 * template script (`node scripts/derive-content.js --json`) against a temp
 * copy of `./fixtures/catalogue.json` + `./fixtures/content/`; it is a
 * committed snapshot, not regenerated at test time, so this test has no
 * network/CLI dependency and no drift risk from template changes landing
 * silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deriveNeeds } from '../derive-needs';
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

describe('deriveNeeds — golden parity with template derive-content.js --json', () => {
  it('matches the committed golden output', () => {
    const catalogue = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'catalogue.json'), 'utf8')) as Catalogue;
    const golden = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'derive-golden.json'), 'utf8'));
    const contentFiles = loadContentFiles();

    const result = deriveNeeds(catalogue, contentFiles);

    expect(result).toEqual(golden);
  });
});

describe('deriveNeeds — unit behavior', () => {
  it('returns zeroed totals for an empty catalogue', () => {
    expect(deriveNeeds({ nodes: [] }, {})).toEqual({ total: 0, authored: 0, derived: 0, nodes: [] });
  });

  it('treats authored:true nodes as authored even when their content file is missing', () => {
    const catalogue: Catalogue = { nodes: [{ id: 'a', authored: true }] };
    const result = deriveNeeds(catalogue, {});
    expect(result).toEqual({ total: 1, authored: 1, derived: 0, nodes: [] });
  });

  it('treats a derived node without an authored:true frontmatter override as needing generation, even if its file exists', () => {
    const catalogue: Catalogue = { nodes: [{ id: 'b', derived: true, title: 'B' }] };
    const result = deriveNeeds(catalogue, { b: '# B\n\nSome regenerated content.' });
    expect(result).toEqual({ total: 1, authored: 0, derived: 1, nodes: [{ id: 'b', title: 'B' }] });
  });

  it('treats a derived node with an authored:true frontmatter override as authored', () => {
    const catalogue: Catalogue = { nodes: [{ id: 'c', derived: true, title: 'C' }] };
    const result = deriveNeeds(catalogue, { c: 'authored: true\n\n# C\n\nHand-edited.' });
    expect(result).toEqual({ total: 1, authored: 1, derived: 0, nodes: [] });
  });

  it('ignores nodes that are neither authored nor derived', () => {
    const catalogue: Catalogue = { nodes: [{ id: 'd' }] };
    const result = deriveNeeds(catalogue, {});
    expect(result).toEqual({ total: 1, authored: 0, derived: 0, nodes: [] });
  });
});
