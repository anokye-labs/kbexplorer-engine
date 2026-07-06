/**
 * `buildManifest()` unit tests (anokye-labs/kbexplorer-engine#17).
 *
 * Covers both `RepoSource` acquisition strategies:
 *  - local assembly, driven by a real `FileSystemSource` over a temp directory
 *    (mirrors `filesystem-source.test.ts`'s fixture style).
 *  - remote assembly, driven by a `GitHubApiSource` seeded directly with a
 *    resolved fetch (mirrors `sources.test.ts`'s `seedSource()` — no network).
 *
 * The fixture/golden parity test against the template's `generate-manifest.js`
 * output lives in `build-manifest-golden.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemSource } from '../filesystem-source';
import { GitHubApiSource } from '../github-api-source';
import { buildManifest } from '../build-manifest';
import { DEFAULT_CONFIG } from '../../default-config';

describe('buildManifest — local (FileSystemSource) assembly', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'kbe-build-manifest-fs-'));
    await mkdir(join(root, 'content'), { recursive: true });
    await mkdir(join(root, '.github'), { recursive: true });

    await writeFile(join(root, 'content', 'alpha.md'), '---\nid: alpha\ntitle: Alpha\n---\n# Alpha\n');
    await writeFile(join(root, 'README.md'), '# Readme\n');
    await writeFile(join(root, '.github', 'CODEOWNERS'), '* @owner\n');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('assembles a RepoManifest from the source\'s RepoData', async () => {
    const source = new FileSystemSource(root, { repo: 'acme/demo' });
    const manifest = await buildManifest(source, { configRaw: 'title: Demo\n', generatedAt: '2024-01-01T00:00:00.000Z' });

    expect(manifest.configRaw).toBe('title: Demo\n');
    expect(manifest.generatedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(manifest.readme).toBe('# Readme\n');
    expect(manifest.authoredContent['content/alpha.md']).toContain('# Alpha');
    expect(manifest.tree.some(t => t.path === 'content/alpha.md')).toBe(true);
    expect(manifest.structuralFiles?.['.github/CODEOWNERS']).toContain('@owner');

    // GitHub-only families stay present-but-empty arrays (RepoManifest requires them).
    expect(manifest.issues).toEqual([]);
    expect(manifest.pullRequests).toEqual([]);
    expect(manifest.commits).toEqual([]);

    // Fields the source has nothing for stay absent (not empty arrays/nulls).
    expect(manifest.branches).toBeUndefined();
    expect(manifest.releases).toBeUndefined();
    expect(manifest.repoMetadata).toBeUndefined();
    expect(manifest.nodemapRaw).toBeUndefined();
    expect(manifest.structuredNodeMapRaw).toBeUndefined();
    expect(manifest.contentModel).toBeUndefined();
    expect(manifest.themeFileRaw).toBeUndefined();
  });

  it('defaults configRaw to null and generatedAt to an ISO timestamp when omitted', async () => {
    const source = new FileSystemSource(root, { repo: 'acme/demo' });
    const before = Date.now();
    const manifest = await buildManifest(source);
    const after = Date.now();

    expect(manifest.configRaw).toBeNull();
    expect(new Date(manifest.generatedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(manifest.generatedAt).getTime()).toBeLessThanOrEqual(after);
  });

  it('is deterministic for source-derived fields across repeated builds', async () => {
    const source = new FileSystemSource(root, { repo: 'acme/demo' });
    const first = await buildManifest(source, { generatedAt: 'fixed' });
    const second = await buildManifest(source, { generatedAt: 'fixed' });

    // generatedAt is pinned identically on both sides — the only field the
    // issue calls out as legitimately volatile when left to its default.
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('buildManifest — remote (GitHubApiSource) assembly', () => {
  /** Seed a resolved fetch so the API source needs no network (mirrors sources.test.ts). */
  function seedSource(): GitHubApiSource {
    const src = new GitHubApiSource(DEFAULT_CONFIG.source, 'full');
    (src as unknown as { fetchPromise: Promise<unknown> }).fetchPromise = Promise.resolve({
      issues: [{ number: 1, title: 'An issue', state: 'open', labels: [{ name: 'bug', color: 'f00' }], body: 'body', html_url: 'https://x/1', user: { login: 'a' }, assignees: [] }],
      pullRequests: [{
        number: 2, title: 'A PR', state: 'open', labels: [], body: 'pr body', html_url: 'https://x/pr/2',
        created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-02T00:00:00.000Z',
        user: { login: 'a' }, assignees: [{ login: 'b' }],
      }],
      tree: [{ path: 'src/a.ts', type: 'blob' }, { path: 'src', type: 'tree' }],
      readme: '# Remote Readme\n',
      commits: [{ sha: 'abc123', commit: { message: 'init', author: { name: 'a', date: '2024-01-01T00:00:00.000Z' } }, html_url: 'https://x/commit/abc123' }],
      releases: [{ tag_name: 'v1.0.0', name: 'v1', body: '', html_url: 'https://x/release/v1', published_at: '2024-01-01T00:00:00.000Z', prerelease: false }],
      authoredContent: { 'content/a.md': 'Body' },
      structuralFiles: { '.github/CODEOWNERS': '* @a\n' },
      structuredNodeMapRaw: null,
      contentModel: null,
      config: DEFAULT_CONFIG,
      themeFileRaw: null,
    });
    return src;
  }

  it('assembles a RepoManifest from the API source\'s RepoData, stripping API-only PR fields', async () => {
    const manifest = await buildManifest(seedSource(), { configRaw: 'title: Remote\n', generatedAt: '2024-01-01T00:00:00.000Z' });

    expect(manifest.configRaw).toBe('title: Remote\n');
    expect(manifest.readme).toBe('# Remote Readme\n');
    expect(manifest.issues).toHaveLength(1);
    expect(manifest.commits).toEqual([{ sha: 'abc123', commit: { message: 'init', author: { name: 'a', date: '2024-01-01T00:00:00.000Z' } }, html_url: 'https://x/commit/abc123' }]);

    // Non-empty optional families become present arrays.
    expect(manifest.releases).toHaveLength(1);
    expect(manifest.structuralFiles?.['.github/CODEOWNERS']).toBe('* @a\n');

    // RepoManifest's pullRequests shape has no user/assignees — GitHubApiSource's
    // RepoData carries them (for PersonProvider), but a manifest snapshot doesn't.
    const [pr] = manifest.pullRequests;
    expect(pr).toEqual({
      number: 2,
      title: 'A PR',
      body: 'pr body',
      state: 'open',
      labels: [],
      html_url: 'https://x/pr/2',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
    });
    expect((pr as unknown as { user?: unknown }).user).toBeUndefined();
    expect((pr as unknown as { assignees?: unknown }).assignees).toBeUndefined();
  });

  it('omits branches/repoMetadata/nodemapRaw when the source has none (GitHubApiSource never fetches them today)', async () => {
    const manifest = await buildManifest(seedSource());
    expect(manifest.branches).toBeUndefined();
    expect(manifest.repoMetadata).toBeUndefined();
    expect(manifest.nodemapRaw).toBeUndefined();
    expect(manifest.contentModel).toBeUndefined();
  });
});
