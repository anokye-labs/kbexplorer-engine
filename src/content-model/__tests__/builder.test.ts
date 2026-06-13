import { describe, it, expect } from 'vitest';
import { buildContentModel } from '../builder';
import type { KBEdge, KBNode } from '../../../types';
import { loadFixtureSource } from './fixtures';

const ADA = 'kg://xbox.com/people/ada';
const BEN = 'kg://xbox.com/people/ben';
const CTO = 'kg://xbox.com/people/cto';
const GAME = 'kg://xbox.com/squads/personalization/game-assist';
const STREAM = 'kg://xbox.com/squads/xcloud/streaming';
const WS = 'kg://xbox.com/workstreams/personalization/personalization-discovery';
const PRIO = 'kg://xbox.com/priorities/p0-latency';
const MISSION = 'kg://xbox.com/missions/personalization/q1-uplift';
const CYCLE = 'kg://xbox.com/cycles/cycle-2';

const source = loadFixtureSource();
const graph = buildContentModel(source);

const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
const node = (id: string): KBNode => {
  const n = nodeMap.get(id);
  if (!n) throw new Error(`node not found: ${id}`);
  return n;
};
const hasEdge = (from: string, to: string, relation: string): boolean =>
  graph.edges.some((e: KBEdge) => e.from === from && e.to === to && e.relation === relation);
const conn = (from: string, to: string, relation: string): boolean =>
  node(from).connections.some(c => c.to === to && c.relation === relation);

describe('content-model builder — node emission (T2.2 / #161)', () => {
  it('emits a JSON-LD node per entity (kind from @type, not the path)', () => {
    const ada = node(ADA);
    expect(ada.entityType).toBe('person');
    expect(ada.display).toBe('entity');
    expect(ada.cluster).toBe('person');
    expect(ada.identity).toBe(ADA);
    expect(ada.source).toEqual({ type: 'structured', entityType: 'person', ref: 'ada' });
    expect(ada.title).toBe('Ada Okonkwo');
    expect(ada.provider).toBe('content-model');
  });

  it('builds a JSON-LD envelope whose @id reuses the identity URN and @type is the kind', () => {
    const ada = node(ADA);
    expect(ada.jsonld?.['@id']).toBe(ADA);
    expect(ada.jsonld?.['@type']).toBe('person');
    // URN bases come from the JSON-LD context (never hardcoded)
    const ctx = ada.jsonld?.['@context'] as Record<string, unknown>;
    expect(ctx.person).toBe('kg://xbox.com/people/');
  });

  it('keeps `data` a verbatim copy of the parsed record (reversible mapping)', () => {
    const ada = node(ADA);
    expect(ada.data).toEqual({
      '@type': 'person',
      id: 'ada',
      alias: 'aokonkwo',
      name: 'Ada Okonkwo',
      role: 'Engineering Lead',
      email: 'ada@example.com',
      manager: 'cto',
      knowledgeAreas: ['graph engines', 'TypeScript'],
    });
    // lifecycle band is surfaced in the LD envelope, NOT in `data`
    expect(ada.data?.lifecycle).toBeUndefined();
    expect(ada.jsonld?.lifecycle).toBe('durable');
  });

  it('merges a companion markdown body into the node content', () => {
    const game = node(GAME);
    expect(game.rawContent).toContain('Game Assist owns');
    expect(game.content).toContain('<');
  });

  it('attaches the underlying source-of-truth file (path + raw + format) for PR write-back (F5 / #152)', () => {
    const ada = node(ADA);
    expect(ada.sourceFile).toEqual({
      path: 'content-model/people/ada.yaml',
      raw: source.files['people/ada.yaml'],
      format: 'yaml',
    });
    // unresolved stubs have no file to edit
    expect(node(CTO).sourceFile).toBeUndefined();
  });
});

describe('content-model builder — org detection (T2.2 / #161)', () => {
  it('places default-org entities flat and still carries the org segment in the URN', () => {
    expect(nodeMap.has(GAME)).toBe(true); // squads/game-assist.yaml → personalization (default)
  });
  it('places non-default-org entities in a per-org subdir reflected in the URN', () => {
    expect(nodeMap.has(STREAM)).toBe(true); // squads/xcloud/streaming.yaml → xcloud
  });
  it('omits the org segment for authority-scoped kinds', () => {
    expect(nodeMap.has(ADA)).toBe(true);
    expect(nodeMap.has(PRIO)).toBe(true);
    expect(nodeMap.has(CYCLE)).toBe(true);
  });
});

describe('content-model builder — FK edge resolution (T2.3 / #162)', () => {
  it('resolves a scalar FK (workstream → priority)', () => {
    expect(hasEdge(WS, PRIO, 'has-priority')).toBe(true);
  });

  it('resolves an array FK (squad → each member person)', () => {
    expect(hasEdge(GAME, ADA, 'staffs')).toBe(true);
    expect(hasEdge(GAME, BEN, 'staffs')).toBe(true);
  });

  it('resolves an alias FK (squad.dri → person by alias handle)', () => {
    expect(hasEdge(GAME, ADA, 'leads')).toBe(true); // dri: aokonkwo → ada
    expect(hasEdge(STREAM, BEN, 'leads')).toBe(true); // dri: bcarter → ben
  });

  it('resolves a composite FK (<cycle>:<squad> → two typed legs)', () => {
    expect(hasEdge(MISSION, CYCLE, 'structural')).toBe(true);
    expect(hasEdge(MISSION, GAME, 'structural')).toBe(true);
  });

  it('stubs an unresolved ref and records a diagnostic', () => {
    expect(hasEdge(ADA, CTO, 'reports-to')).toBe(true); // ada.manager: cto (no such person)
    const cto = node(CTO);
    expect(cto.data?.unresolved).toBe(true);
    expect(graph.diagnostics.some(d => d.code === 'unresolved-ref' && d.ref === CTO)).toBe(true);
  });

  it('resolves a normal manager FK (ben → ada)', () => {
    expect(hasEdge(BEN, ADA, 'reports-to')).toBe(true);
  });

  it('attaches relationships as connections on the source node so buildGraph renders them', () => {
    expect(conn(GAME, ADA, 'staffs')).toBe(true);
    expect(conn(GAME, WS, 'structural')).toBe(true);
  });
});

describe('content-model builder — derived + deprecated (T2.3 / #162)', () => {
  it('computes a derived shared-target edge (squads sharing a workstream), deduped', () => {
    const derived = graph.edges.filter(e => e.relation === 'derived'
      && [e.from, e.to].includes(GAME) && [e.from, e.to].includes(STREAM));
    expect(derived.length).toBe(1); // undirected: stored once
  });

  it('resolves a deprecated FK but tags it `deprecated`', () => {
    expect(hasEdge(GAME, BEN, 'deprecated')).toBe(true); // legacyOwner: bcarter → ben
  });
});

describe('content-model builder — safe no-op when absent', () => {
  it('returns empty results when no source is present', () => {
    expect(buildContentModel(null)).toEqual({ nodes: [], edges: [], diagnostics: [] });
    expect(buildContentModel({ root: 'x', files: {} })).toEqual({ nodes: [], edges: [], diagnostics: [] });
  });
});
