/**
 * Cross-repo vocabulary / synonym layer (#153).
 *
 * Proves that a per-repo alias term (a word one repo uses for a concept) is
 * canonicalized to the shared kind — getting the right cluster, URN and bespoke
 * viewer — while the repo's native label is preserved, that two differing
 * vocabularies unify across repos (via a declared file *or* an independently
 * supplied overlay), and that with no vocabulary declared the layer is a
 * strictly-additive safe no-op (output byte-identical to before).
 */
import { describe, it, expect } from 'vitest';
import { buildContentModel, type ContentModelGraph } from '../builder';
import { readContentModelSchema, canonicalKind } from '../schema-reader';
import type { ContentModelSource, Vocabulary } from '../types';
import { loadFixtureSource } from './fixtures';
import { registerContentModelTypes } from '../register';
import { resolveViewer } from '../../../views/viewers/registry';
import { SquadView } from '../../../views/viewers/SquadView';
import { GenericStructuredView } from '../../../views/viewers/GenericStructuredView';
import type { KBNode } from '../../../types';

const CELL = 'kg://xbox.com/squads/personalization/night-owls';
const CREW = 'kg://xbox.com/squads/xcloud/dawn-crew';
const GAME = 'kg://xbox.com/squads/personalization/game-assist';

// A repo that calls a squad a "cell" (flat file → default org).
const CELL_YAML = [
  '"@type": cell',
  'id: night-owls',
  'name: Night Owls',
  'workstream: personalization-discovery',
  'members:',
  '  - ada',
  '',
].join('\n');

// A different repo (xcloud org) that calls the same concept a "crew".
const CREW_YAML = [
  '"@type": crew',
  'id: dawn-crew',
  'name: Dawn Crew',
  'workstream: personalization-discovery',
  'members:',
  '  - ben',
  '',
].join('\n');

// A vocabulary.jsonld authored exactly like the JSON-LD context — bare string
// and `{ "@id": … }` forms both supported.
const VOCAB_FILE = JSON.stringify({ '@context': { cell: 'squad', crew: { '@id': 'squad' } } });

/** Clone the fixture source and splice in extra files. */
function withFiles(extra: Record<string, string>): ContentModelSource {
  const base = loadFixtureSource();
  return { root: base.root, files: { ...base.files, ...extra } };
}

const nodeOf = (graph: { nodes: KBNode[] }, id: string): KBNode => {
  const n = graph.nodes.find(x => x.id === id);
  if (!n) throw new Error(`node not found: ${id}`);
  return n;
};

/** A derived `shared-target` edge is undirected (stored once on the lower URN). */
const hasDerivedBetween = (graph: Pick<ContentModelGraph, 'edges'>, a: string, b: string): boolean =>
  graph.edges.some(e => e.relation === 'derived'
    && ((e.from === a && e.to === b) || (e.from === b && e.to === a)));

describe('cross-repo vocabulary — alias canonicalization (#153)', () => {
  const graph = buildContentModel(
    withFiles({ 'index/vocabulary.jsonld': VOCAB_FILE, 'squads/night-owls.yaml': CELL_YAML }),
  );

  it('resolves an alias `@type` (cell) to the canonical kind (squad)', () => {
    const cell = nodeOf(graph, CELL);
    expect(cell.entityType).toBe('squad');
    expect(cell.cluster).toBe('squad');
    expect(cell.jsonld?.['@type']).toBe('squad');
    // URN base resolved via the canonical kind's CURIE prefix (org-scoped squad).
    expect(cell.id).toBe(CELL);
  });

  it('routes the aliased node to the canonical kind\'s bespoke viewer (SquadView)', () => {
    registerContentModelTypes();
    const cell = nodeOf(graph, CELL);
    expect(resolveViewer(cell)).toBe(SquadView);
    expect(resolveViewer(cell)).not.toBe(GenericStructuredView);
  });

  it('preserves the repo\'s native term (cell) on `data` and `jsonld.nativeType`', () => {
    const cell = nodeOf(graph, CELL);
    expect((cell.data as Record<string, unknown>)['@type']).toBe('cell');
    expect(cell.jsonld?.nativeType).toBe('cell');
    expect(cell.title).toBe('Night Owls');
  });

  it('ties the aliased node into the canonical graph (shares workstream, staffs members)', () => {
    const cell = nodeOf(graph, CELL);
    // shares `personalization-discovery` with game-assist → derived co-alignment
    expect(hasDerivedBetween(graph, CELL, GAME)).toBe(true);
    expect(cell.connections.some(c => c.relation === 'staffs')).toBe(true);
  });
});

describe('cross-repo vocabulary — unifying two differing vocabularies (#153)', () => {
  const expectUnified = (graph: ContentModelGraph) => {
    const cell = nodeOf(graph, CELL);
    const crew = nodeOf(graph, CREW);
    // Both unify under the single canonical type…
    expect(cell.entityType).toBe('squad');
    expect(crew.entityType).toBe('squad');
    expect(cell.cluster).toBe('squad');
    expect(crew.cluster).toBe('squad');
    // …while each keeps its own native label.
    expect(cell.jsonld?.nativeType).toBe('cell');
    expect(crew.jsonld?.nativeType).toBe('crew');
    // and they are linked to each other via the shared workstream.
    expect(hasDerivedBetween(graph, CELL, CREW)).toBe(true);
  };

  it('unifies via a declared `index/vocabulary.jsonld`', () => {
    const graph = buildContentModel(
      withFiles({
        'index/vocabulary.jsonld': VOCAB_FILE,
        'squads/night-owls.yaml': CELL_YAML,
        'squads/xcloud/dawn-crew.yaml': CREW_YAML,
      }),
    );
    expectUnified(graph);
  });

  it('unifies via a shared overlay supplied independently of any repo file (parsed Vocabulary)', () => {
    const overlay: Vocabulary = { aliases: { cell: 'squad', crew: 'squad' } };
    const graph = buildContentModel(
      withFiles({ 'squads/night-owls.yaml': CELL_YAML, 'squads/xcloud/dawn-crew.yaml': CREW_YAML }),
      overlay,
    );
    expectUnified(graph);
  });

  it('unifies via a shared overlay supplied as raw vocabulary.jsonld text', () => {
    const graph = buildContentModel(
      withFiles({ 'squads/night-owls.yaml': CELL_YAML, 'squads/xcloud/dawn-crew.yaml': CREW_YAML }),
      VOCAB_FILE,
    );
    expectUnified(graph);
  });

  it('lets an overlay term win over the repo-local file on collision', () => {
    const { schema } = readContentModelSchema(
      withFiles({ 'index/vocabulary.jsonld': JSON.stringify({ '@context': { cell: 'squad' } }) }),
      { aliases: { cell: 'person' } },
    );
    expect(schema.vocabulary.aliases.cell).toBe('person');
  });
});

describe('cross-repo vocabulary — safe no-op when absent (#153)', () => {
  it('has an empty alias map and leaves canonicalKind a pass-through when none declared', () => {
    const { schema } = readContentModelSchema(loadFixtureSource());
    expect(schema.vocabulary.aliases).toEqual({});
    expect(canonicalKind(schema, 'squad')).toBe('squad');
    expect(canonicalKind(schema, 'anything')).toBe('anything');
  });

  it('never stamps `jsonld.nativeType` on a node whose @type was already canonical', () => {
    const graph = buildContentModel(loadFixtureSource());
    expect(graph.nodes.every(n => n.jsonld?.nativeType === undefined)).toBe(true);
    expect(nodeOf(graph, GAME).jsonld?.nativeType).toBeUndefined();
  });

  it('produces byte-identical output to a plain build when synonyms are declared but unused', () => {
    const plain = buildContentModel(loadFixtureSource());
    // Declaring `cell`/`crew` aliases that no entity uses must change nothing.
    const withUnusedVocab = buildContentModel(
      withFiles({ 'index/vocabulary.jsonld': VOCAB_FILE }),
    );
    expect(withUnusedVocab.nodes).toEqual(plain.nodes);
    expect(withUnusedVocab.edges).toEqual(plain.edges);
  });

  it('treats an empty overlay the same as no overlay', () => {
    const plain = buildContentModel(loadFixtureSource());
    const emptyOverlay = buildContentModel(loadFixtureSource(), { aliases: {} });
    expect(emptyOverlay.nodes).toEqual(plain.nodes);
    expect(emptyOverlay.edges).toEqual(plain.edges);
  });
});

describe('cross-repo vocabulary — robust parsing (#153 review)', () => {
  it('ignores an array-valued `@context` instead of mapping numeric indices', () => {
    // A legal JSON-LD array context carries no inline term→canonical aliases;
    // iterating it by index would otherwise yield bogus keys like "0"/"1".
    const { schema } = readContentModelSchema(
      withFiles({
        'index/vocabulary.jsonld': JSON.stringify({
          '@context': ['https://schema.org', { cell: 'squad' }],
        }),
      }),
    );
    expect(schema.vocabulary.aliases).toEqual({});
  });

  it('attributes an invalid overlay to the overlay, not the repo file', () => {
    const { diagnostics } = readContentModelSchema(loadFixtureSource(), '{ not json');
    const bad = diagnostics.find(d => d.code === 'bad-vocabulary');
    expect(bad?.message).toBe('vocabulary overlay is not valid JSON');
  });

  it('attributes an invalid repo-local vocabulary file to its path', () => {
    const { diagnostics } = readContentModelSchema(
      withFiles({ 'index/vocabulary.jsonld': '{ not json' }),
    );
    const bad = diagnostics.find(d => d.code === 'bad-vocabulary');
    expect(bad?.message).toBe('index/vocabulary.jsonld is not valid JSON');
  });
});
