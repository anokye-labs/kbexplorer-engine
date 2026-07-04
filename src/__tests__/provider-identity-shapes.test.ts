/**
 * Dedicated cross-provider identity tests (#445 — AF-037 / AF-042).
 *
 * `src/engine/identity.ts` is the template's single identity mechanism, yet it
 * never had a test asserting the id/identity CONTRACT per provider — which is
 * exactly how the id === identity collapses (content-model #175, rich-markdown
 * #432, external providers never assigning identity at all) shipped unnoticed.
 *
 * Two guarantees, per provider:
 *  1. SHAPE — every emitted node carries the documented identity pattern for
 *     its source type, and (where the provider mints one) a LOCAL `id` that is
 *     never the same string as the canonical `identity`.
 *  2. DETERMINISM — resolving the same inputs twice yields byte-identical
 *     (id, identity) pairs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_CONFIG } from '../default-config';
import type { KBNode } from '@anokye-labs/kbexplorer-core';
import { FilesProvider } from '../providers/files-provider';
import { AuthoredProvider } from '../providers/authored-provider';
import { AuthoredRichMarkdownProvider } from '../providers/authored-rich-markdown-provider';
import { WorkProvider } from '../providers/work-provider';
import { PersonProvider } from '../providers/person-provider';
import { StructuralProvider } from '../providers/structural-provider';
import { ContentModelProvider } from '../providers/content-model-provider';
import { WikipediaProvider } from '../providers/wikipedia-provider';
import { OrgChartProvider } from '../providers/orgchart-provider';
import type { GraphProvider } from '../providers';
import type { GHIssue } from '../github-types';
import { loadFixtureSource } from '../content-model/__tests__/fixtures';

const config = DEFAULT_CONFIG;

// ── Shared fixtures ────────────────────────────────────────

const issue: GHIssue = {
  number: 42,
  title: 'Fix crash',
  body: 'body',
  state: 'open',
  labels: [],
  assignees: [{ login: 'ada' }],
  html_url: 'https://github.com/x/y/issues/42',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  user: { login: 'ada' },
};

const pullRequest = {
  number: 7,
  title: 'Add feature',
  body: '',
  state: 'open',
  labels: [],
  html_url: 'https://github.com/x/y/pull/7',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  user: { login: 'ada' },
  assignees: [],
};

const release = {
  tag_name: 'v1.2.3',
  name: 'Release 1.2.3',
  body: '',
  html_url: 'https://github.com/x/y/releases/v1.2.3',
  published_at: '2024-02-01T00:00:00Z',
  prerelease: false,
};

const authoredDoc = [
  '---',
  'id: intro',
  'title: Introduction',
  'cluster: docs',
  '---',
  '',
  '# Introduction',
  'Plain prose.',
].join('\n');

const richDoc = [
  '---',
  'id: platform',
  'title: Platform Overview',
  'display: rich-markdown',
  'cluster: docs',
  '---',
  '',
  '# Platform Overview',
  '',
  '```mermaid',
  'flowchart LR',
  '  A --> B',
  '```',
].join('\n');

function mockWikipediaFetch(): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      title: 'Knowledge graph',
      extract: 'A knowledge graph.',
      extract_html: '<p>A knowledge graph.</p>',
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Knowledge_graph' } },
    }),
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── The per-provider identity-shape table (AF-037) ─────────

interface ShapeCase {
  name: string;
  make: () => GraphProvider;
  setup?: () => void;
  /** node id to inspect → the exact identity expected for it */
  expected: Array<{ id: string; identity: string | undefined }>;
}

const CASES: ShapeCase[] = [
  {
    name: 'FilesProvider — urn:file:<path>',
    make: () =>
      new FilesProvider(
        [
          { path: 'src', mode: '040000', type: 'tree', sha: 'a', url: '' },
          { path: 'src/main.ts', mode: '100644', type: 'blob', sha: 'b', url: '' },
        ],
        'my-repo',
      ),
    expected: [{ id: 'file-src/main.ts', identity: 'urn:file:src/main.ts' }],
  },
  {
    name: 'AuthoredProvider — urn:content:<doc id>',
    make: () => new AuthoredProvider({ 'content/intro.md': authoredDoc }),
    expected: [{ id: 'intro', identity: 'urn:content:intro' }],
  },
  {
    name: 'AuthoredRichMarkdownProvider — urn:content:<doc id> (same scheme as plain authored)',
    make: () => new AuthoredRichMarkdownProvider({ 'content/platform.md': richDoc }),
    expected: [{ id: 'platform', identity: 'urn:content:platform' }],
  },
  {
    name: 'WorkProvider — urn:issue:/urn:pr:/urn:release:',
    make: () => new WorkProvider([issue], [pullRequest], [], [], null, [release]),
    expected: [
      { id: 'issue-42', identity: 'urn:issue:42' },
      { id: 'pr-7', identity: 'urn:pr:7' },
      { id: 'release-v1.2.3', identity: 'urn:release:v1.2.3' },
    ],
  },
  {
    name: 'PersonProvider — urn:person:<login>',
    make: () => new PersonProvider([issue], []),
    expected: [{ id: 'person-ada', identity: 'urn:person:ada' }],
  },
  {
    name: 'StructuralProvider — urn:structural:<path>',
    make: () =>
      new StructuralProvider({
        '.github/workflows/ci.yml': 'name: CI\non: push\n',
        '.github/dependabot.yml': 'version: 2\n',
      }),
    expected: [
      { id: 'gh-workflow-ci-yml', identity: 'urn:structural:.github/workflows/ci.yml' },
      { id: 'gh-dependabot-dependabot-yml', identity: 'urn:structural:.github/dependabot.yml' },
    ],
  },
  {
    name: 'ContentModelProvider — schema-minted kg:// URN with DISTINCT local id',
    make: () => new ContentModelProvider(loadFixtureSource()),
    expected: [
      { id: 'xbox.com/people/ada', identity: 'kg://xbox.com/people/ada' },
      {
        id: 'xbox.com/squads/personalization/game-assist',
        identity: 'kg://xbox.com/squads/personalization/game-assist',
      },
    ],
  },
  {
    name: 'WikipediaProvider (external) — urn:external:<provider>:<node id>',
    setup: mockWikipediaFetch,
    make: () =>
      new WikipediaProvider({
        type: 'wikipedia',
        name: 'Reference',
        options: { articles: [{ title: 'Knowledge graph' }] },
      }),
    expected: [
      {
        id: 'wiki-knowledge-graph',
        identity: 'urn:external:wikipedia-reference:wiki-knowledge-graph',
      },
    ],
  },
  {
    name: 'OrgChartProvider (external) — urn:external:<provider>:<node id>',
    make: () =>
      new OrgChartProvider({
        type: 'orgchart',
        name: 'Team',
        options: { people: [{ id: 'ceo', name: 'Jane Smith', role: 'CEO' }] },
      }),
    expected: [{ id: 'org-ceo', identity: 'urn:external:orgchart-team:org-ceo' }],
  },
];

async function resolveNodes(c: ShapeCase): Promise<KBNode[]> {
  c.setup?.();
  const { nodes } = await c.make().resolve(config, []);
  return nodes;
}

describe('provider identity shapes (AF-037)', () => {
  it.each(CASES.map(c => [c.name, c] as const))('%s', async (_name, c) => {
    const nodes = await resolveNodes(c);
    for (const want of c.expected) {
      const node = nodes.find(n => n.id === want.id);
      expect(node, `node ${want.id} should be emitted`).toBeDefined();
      expect(node!.identity).toBe(want.identity);
      // The two fields answer DIFFERENT questions (id = provider-local key,
      // identity = cross-provider merge key) and must never collapse.
      expect(node!.identity).not.toBe(node!.id);
    }
  });

  it('every identity-bearing node keeps id and identity distinct, across all providers', async () => {
    for (const c of CASES) {
      const nodes = await resolveNodes(c);
      vi.restoreAllMocks();
      for (const n of nodes) {
        if (n.identity == null) continue;
        expect(n.identity, `${c.name}: node ${n.id} collapsed id === identity`).not.toBe(n.id);
      }
    }
  });
});

// ── Determinism (AF-042) ───────────────────────────────────

describe('provider identity determinism (AF-042)', () => {
  it.each(CASES.map(c => [c.name, c] as const))(
    '%s — same input twice → same (id, identity) pairs',
    async (_name, c) => {
      const first = (await resolveNodes(c)).map(n => [n.id, n.identity]);
      vi.restoreAllMocks();
      const second = (await resolveNodes(c)).map(n => [n.id, n.identity]);
      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual(first);
    },
  );
});
