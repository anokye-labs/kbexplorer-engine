/**
 * Golden fixture parity test (anokye-labs/kbexplorer-engine#19): asserts
 * `enrichFromManifest()` reproduces kbexplorer-template's
 * `scripts/enrich-context.js` output byte-for-byte on the same catalogue/
 * manifest fixtures.
 *
 * `./fixtures/enriched-catalogue-golden.json` was captured by running the
 * actual template script (`node scripts/enrich-context.js`, which writes
 * `content/catalogue-enriched.json`) against a temp copy of
 * `./fixtures/catalogue.json` + `./fixtures/repo-manifest.json`; it is a
 * committed snapshot, not regenerated at test time, so this test has no
 * network/CLI dependency and no drift risk from template changes landing
 * silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enrichFromManifest } from '../enrich-from-manifest';
import type { Catalogue } from '../types';
import type { RepoManifest } from '../../sources/repo-manifest';

const FIXTURES_ROOT = join(__dirname, 'fixtures');

describe('enrichFromManifest — golden parity with template enrich-context.js', () => {
  it('matches the committed enriched-catalogue golden', () => {
    const catalogue = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'catalogue.json'), 'utf8')) as Catalogue;
    const manifest = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'repo-manifest.json'), 'utf8')) as RepoManifest;
    const golden = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'enriched-catalogue-golden.json'), 'utf8'));

    const result = enrichFromManifest(catalogue, manifest);

    expect(result.catalogue).toEqual(golden);
  });

  it('matches the hand-verified summary counts', () => {
    const catalogue = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'catalogue.json'), 'utf8')) as Catalogue;
    const manifest = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'repo-manifest.json'), 'utf8')) as RepoManifest;

    const result = enrichFromManifest(catalogue, manifest);

    // Captured from the template script's stderr summary lines for this fixture:
    //   [enrich] 3 issues, 2 PRs, 2 commits
    //   [enrich] Enriched 7 nodes:
    //   [enrich]   2 have related issues
    //   [enrich]   1 have related PRs
    //   [enrich]   1 have related commits
    expect(result.summary).toEqual({
      issueCount: 3,
      prCount: 2,
      commitCount: 2,
      totalNodes: 7,
      nodesWithIssues: 2,
      nodesWithPRs: 1,
      nodesWithCommits: 1,
    });
  });
});

describe('enrichFromManifest — unit behavior', () => {
  const emptyManifest: RepoManifest = {
    configRaw: null,
    authoredContent: {},
    tree: [],
    readme: null,
    issues: [],
    pullRequests: [],
    commits: [],
    generatedAt: '2024-01-01T00:00:00.000Z',
  };

  it('attaches empty related-* arrays when the manifest has no issues/PRs/commits', () => {
    const catalogue: Catalogue = { nodes: [{ id: 'a', title: 'A', file: 'a.md' }] };
    const result = enrichFromManifest(catalogue, emptyManifest);

    expect(result.catalogue.nodes).toEqual([{ id: 'a', title: 'A', file: 'a.md', relatedIssues: [], relatedPRs: [], recentCommits: [] }]);
    expect(result.summary).toEqual({
      issueCount: 0,
      prCount: 0,
      commitCount: 0,
      totalNodes: 1,
      nodesWithIssues: 0,
      nodesWithPRs: 0,
      nodesWithCommits: 0,
    });
  });

  it('caps related issues/PRs/commits at their per-node limits', () => {
    const manifest: RepoManifest = {
      ...emptyManifest,
      issues: Array.from({ length: 10 }, (_, i) => ({
        number: i,
        title: `alpha issue ${i}`,
        body: 'mentions alpha.md',
        state: 'open',
        html_url: '',
        created_at: '',
        updated_at: '',
        labels: [],
      })),
    };
    const catalogue: Catalogue = { nodes: [{ id: 'alpha', title: 'Alpha', file: 'alpha.md' }] };

    const result = enrichFromManifest(catalogue, manifest);

    expect(result.catalogue.nodes[0]?.relatedIssues).toHaveLength(5);
  });

  it('does not match on very short titles for commit messages', () => {
    const manifest: RepoManifest = {
      ...emptyManifest,
      commits: [
        {
          sha: '1234567890abcdef',
          commit: { message: 'fix ab bug', author: { name: 'Dev', date: '2024-01-01T00:00:00Z' } },
          html_url: '',
        },
      ],
    };
    // Title "ab" is 2 chars (<= MIN_TITLE_LENGTH_FOR_COMMIT_MATCH) and the file
    // field is absent, so this must not match even though "ab" appears in the message.
    const catalogue: Catalogue = { nodes: [{ id: 'ab', title: 'ab' }] };

    const result = enrichFromManifest(catalogue, manifest);

    expect(result.catalogue.nodes[0]?.recentCommits).toEqual([]);
  });
});
