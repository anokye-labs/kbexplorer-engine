/**
 * Golden fixture parity test (anokye-labs/kbexplorer-engine#17 acceptance
 * criteria): asserts `buildManifest()` driven by a `FileSystemSource` over
 * `./fixtures/manifest-repo` produces source-derived fields structurally
 * identical to what kbexplorer-template's `scripts/generate-manifest.js`
 * (`generateManifest()`) emits for the exact same directory.
 *
 * `./fixtures/manifest-golden.json` was captured by running the actual
 * template script against this fixture directory (see the file's `_comment`
 * for how/why); it is a committed snapshot, not regenerated at test time, so
 * this test has no network/CLI dependency and no drift risk from template
 * changes landing silently.
 *
 * Only source-derived fields are compared. `issues` / `pullRequests` /
 * `commits` / `branches` / `repoMetadata` are excluded: the template script
 * fetches those via `gh`/`git` CLI calls, which are template-side automation
 * around the manifest, not something a `RepoSource` (and therefore
 * `buildManifest`) provides — `FileSystemSource` documents leaving them as
 * safe no-ops (see `filesystem-source.test.ts`). `generatedAt` is excluded as
 * the one field the issue explicitly calls out as legitimately volatile.
 *
 * `tree` is compared with `size` stripped from both sides: `FileSystemSource`
 * (existing, pre-#17 behavior) does not stat files while the template's
 * `walkFileSystem` does — a pre-existing, out-of-scope divergence that
 * `buildManifest` neither introduces nor is chartered to fix.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileSystemSource } from '../filesystem-source';
import { buildManifest } from '../build-manifest';

const FIXTURE_ROOT = join(__dirname, 'fixtures', 'manifest-repo');
const GOLDEN_PATH = join(__dirname, 'fixtures', 'manifest-golden.json');

interface TreeItem { path: string; type: 'blob' | 'tree'; size?: number }
const stripSize = (items: TreeItem[]) =>
  [...items].sort((a, b) => a.path.localeCompare(b.path)).map(({ path, type }) => ({ path, type }));

describe('buildManifest — golden parity with template generate-manifest.js', () => {
  it('matches the committed golden for every source-derived field', async () => {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as {
      tree: TreeItem[];
      authoredContent: Record<string, string>;
      readme: string | null;
      structuralFiles: Record<string, string>;
      contentModel: { root: string; files: Record<string, string> } | null;
      configRaw: string | null;
      nodemapRaw: string | null;
      structuredNodeMapRaw: string | null;
      themeFileRaw: string | null;
    };

    const configRaw = readFileSync(join(FIXTURE_ROOT, 'config.yaml'), 'utf8');
    const source = new FileSystemSource(FIXTURE_ROOT, { repo: 'acme/manifest-repo' });
    const manifest = await buildManifest(source, { configRaw, generatedAt: '2024-01-01T00:00:00.000Z' });

    expect(stripSize(manifest.tree)).toEqual(stripSize(golden.tree));
    expect(manifest.authoredContent).toEqual(golden.authoredContent);
    expect(manifest.readme).toBe(golden.readme);
    expect(manifest.structuralFiles).toEqual(golden.structuralFiles);
    expect(manifest.contentModel).toEqual(golden.contentModel);
    expect(manifest.configRaw).toBe(golden.configRaw);
    expect(manifest.nodemapRaw ?? null).toBe(golden.nodemapRaw);
    expect(manifest.structuredNodeMapRaw ?? null).toBe(golden.structuredNodeMapRaw);
    expect(manifest.themeFileRaw ?? null).toBe(golden.themeFileRaw);
  });
});
