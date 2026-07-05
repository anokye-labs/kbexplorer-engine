/**
 * Slice 4/5 (anokye-labs/kbexplorer-template#472) — Source abstraction contract
 * tests, ported from template's `src/engine/__tests__/sources.test.ts`.
 *
 * Verifies the situational (per-retrieval) affordance model, the first-class
 * staging-area link, and the strict Git ≠ GitHub resource-family separation —
 * plus the read-only ManifestSource invariant. Fully self-contained: the API
 * source's fetch is seeded directly, so there is no network access.
 */
import { describe, it, expect } from 'vitest';
import { hasAffordance, stagingAreaLink, STAGING_AREA_REL } from '@anokye-labs/kbexplorer-core';
import { DEFAULT_CONFIG } from '../default-config';
import { GitHubApiSource } from '../sources/github-api-source';
import { ManifestSource } from '../sources/manifest-source';
import type { RepoManifest } from '../sources/repo-manifest';

/** Inject a resolved fetch so the API source needs no network. */
function seedSource(): GitHubApiSource {
  const src = new GitHubApiSource(DEFAULT_CONFIG.source, 'standard');
  (src as unknown as { fetchPromise: Promise<unknown> }).fetchPromise = Promise.resolve({
    issues: [{ number: 1, title: 'An issue', state: 'open', labels: [], body: '', html_url: '', user: { login: 'a' }, assignees: [] }],
    pullRequests: [{ number: 2, title: 'A PR', state: 'open', labels: [], body: '', html_url: '', created_at: '', updated_at: '', user: { login: 'a' }, assignees: [] }],
    tree: [{ path: 'src/a.ts', type: 'blob' }, { path: 'src', type: 'tree' }],
    readme: null,
    commits: [{ sha: 'abc123', commit: { message: 'init', author: { name: 'a', date: '' } }, html_url: '' }],
    releases: [{ tag_name: 'v1.0.0', name: 'v1', body: '', html_url: '', published_at: '' }],
    authoredContent: {},
    structuralFiles: {},
    structuredNodeMapRaw: null,
    config: DEFAULT_CONFIG,
  });
  return src;
}

describe('GitHubApiSource — per-retrieval situational affordances', () => {
  it('returns read-only for a plain file read', async () => {
    const files = await seedSource().retrieve({ kind: 'file' });
    const file = files.find(r => r.kind === 'file');
    expect(file).toBeDefined();
    expect(file!.affordances).toEqual(['read']);
    expect(stagingAreaLink(file!)).toBeUndefined();
  });

  it('returns read/write/stage for the same file against a writable worktree', async () => {
    const files = await seedSource().retrieve({ kind: 'file', worktree: true });
    const file = files.find(r => r.kind === 'file')!;
    expect(hasAffordance(file, 'write')).toBe(true);
    expect(hasAffordance(file, 'stage')).toBe(true);
    // Writable but not yet staged — no staging-area link.
    expect(stagingAreaLink(file)).toBeUndefined();
  });

  it('a staged file carries a first-class staging-area link', async () => {
    const files = await seedSource().retrieve({ kind: 'file', staged: true });
    const file = files.find(r => r.kind === 'file')!;
    const link = stagingAreaLink(file);
    expect(link).toBeDefined();
    expect(link!.rel).toBe(STAGING_AREA_REL);
    // The staging area it links to is itself retrievable.
    const area = await seedSource().get(link!.href);
    expect(area?.kind).toBe('staging-area');
  });
});

describe('GitHubApiSource — Git ≠ GitHub families', () => {
  it('exposes git resources under git:// and github resources under github://', async () => {
    const all = await seedSource().retrieve({});
    const byKind = (k: string) => all.filter(r => r.kind === k);

    for (const k of ['file', 'tree', 'commit']) {
      expect(byKind(k).every(r => r.href.startsWith('git://'))).toBe(true);
    }
    for (const k of ['issue', 'pull-request', 'release']) {
      expect(byKind(k).every(r => r.href.startsWith('github://'))).toBe(true);
    }
    // GitHub operations (merge/comment) never leak onto git resources.
    expect(byKind('file').some(r => hasAffordance(r, 'merge'))).toBe(false);
    expect(byKind('pull-request').some(r => hasAffordance(r, 'merge'))).toBe(true);
  });
});

describe('ManifestSource — read-only', () => {
  const manifest = {
    configRaw: null,
    authoredContent: {},
    tree: [{ path: 'README.md', type: 'blob' as const }],
    readme: null,
    issues: [{ number: 1, title: 'x', state: 'open', labels: [], body: '', html_url: '' }],
    pullRequests: [],
    commits: [],
    generatedAt: '',
  } as unknown as RepoManifest;

  it('every retrieved resource is read-only', async () => {
    const src = new ManifestSource(manifest, DEFAULT_CONFIG);
    const all = await src.retrieve({});
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      expect(r.affordances).toEqual(['read']);
      expect(stagingAreaLink(r)).toBeUndefined();
    }
  });

  it('possibleAffordances advertises read only (no staging area)', () => {
    const src = new ManifestSource(manifest, DEFAULT_CONFIG);
    expect(src.possibleAffordances).toEqual(['read']);
  });
});
