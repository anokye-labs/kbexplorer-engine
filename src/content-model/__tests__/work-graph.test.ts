/**
 * Work-graph vocabulary tests (issue #233).
 *
 * Hermetic: all fixtures are inline strings or extend the existing
 * {@link loadFixtureSource} tree (which already has the new schema entries).
 * Covers:
 *  - Happy-path node emission per kind (team, workstream, priority, person, system-of-record)
 *  - Derived edge derivation: member-of, owns, has-priority, tracked-in
 *  - Dangling-reference validation (unresolved-ref diagnostic)
 *  - sourceFile attachment so the F5 editor affordance lights up
 *  - Cluster assignment and lifecycle band for the organizational layer
 */
import { describe, it, expect } from 'vitest';
import { buildContentModel } from '../builder';
import { urnLocalId } from '../schema-reader';
import type { KBEdge, KBNode } from '@anokye-labs/kbexplorer-core';
import { loadFixtureSource } from './fixtures';
import type { ContentModelSource } from '../types';

// ── URN constants ──────────────────────────────────────────────────────────────
// Canonical identity URNs (node.identity). Since #445 / AF-003 the node `id` is
// the DISTINCT local key `urnLocalId(urn)`; helpers below convert.

const TEAM = 'kg://xbox.com/teams/personalization/graph-platform';
const WS   = 'kg://xbox.com/workstreams/personalization/personalization-discovery';
const PRIO = 'kg://xbox.com/priorities/p0-latency';
const ADA  = 'kg://xbox.com/people/ada';
const BEN  = 'kg://xbox.com/people/ben';
const SOR  = 'kg://xbox.com/systems-of-record/gh-issues';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Load the fixture source (already augmented with work-graph schema entries). */
const source = loadFixtureSource();

/** Build graph once to share across tests (fixture is static). */
const graph = buildContentModel(source);

const lid = urnLocalId;

const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

/** Look up a node by its canonical URN (via the deterministic local-id mapping). */
function node(urn: string): KBNode {
  const n = nodeMap.get(lid(urn));
  if (!n) throw new Error(`node not found: ${urn}`);
  return n;
}

function hasEdge(from: string, to: string, relation: string): boolean {
  return graph.edges.some((e: KBEdge) => e.from === lid(from) && e.to === lid(to) && e.relation === relation);
}

function hasConn(fromUrn: string, toUrn: string, relation: string): boolean {
  return node(fromUrn).connections.some(c => c.to === lid(toUrn) && c.relation === relation);
}

/** Inline helper: extend the fixture source with extra files. */
function withFiles(extra: Record<string, string>): ContentModelSource {
  return { root: source.root, files: { ...source.files, ...extra } };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('work-graph vocabulary — team kind (#233)', () => {
  it('emits a team node with @type=team, cluster=team, display=entity', () => {
    const t = node(TEAM);
    expect(t.entityType).toBe('team');
    expect(t.cluster).toBe('team');
    expect(t.display).toBe('entity');
    expect(t.provider).toBe('content-model');
  });

  it('carries the correct title from `name`', () => {
    expect(node(TEAM).title).toBe('Graph Platform');
  });

  it('attaches sourceFile so the F5 editor affordance lights up', () => {
    const t = node(TEAM);
    expect(t.sourceFile).toBeDefined();
    expect(t.sourceFile?.path).toMatch(/teams\/graph-platform\.yaml$/);
    expect(t.sourceFile?.format).toBe('yaml');
    expect(typeof t.sourceFile?.raw).toBe('string');
    expect(t.sourceFile?.raw.length).toBeGreaterThan(0);
  });

  it('gets the durable lifecycle band', () => {
    expect(node(TEAM).jsonld?.lifecycle).toBe('durable');
  });

  it('keeps data as a verbatim copy of the parsed record', () => {
    const d = node(TEAM).data as Record<string, unknown>;
    expect(d['@type']).toBe('team');
    expect(d.id).toBe('graph-platform');
    expect(d.name).toBe('Graph Platform');
    expect(Array.isArray(d.members)).toBe(true);
    expect(Array.isArray(d.workstreams)).toBe(true);
  });
});

describe('work-graph vocabulary — team derived edges (#233)', () => {
  it('derives a leads edge from team.lead (alias FK → person)', () => {
    // team fixture: lead: aokonkwo → resolves to ada (alias aokonkwo)
    expect(hasEdge(TEAM, ADA, 'leads')).toBe(true);
  });

  it('derives staffs edges from team.members (array FK → person[])', () => {
    expect(hasEdge(TEAM, ADA, 'staffs')).toBe(true);
    expect(hasEdge(TEAM, BEN, 'staffs')).toBe(true);
  });

  it('derives an owns edge from team.workstreams (array FK → workstream)', () => {
    expect(hasEdge(TEAM, WS, 'owns')).toBe(true);
  });

  it('attaches the owns connection to the team node so buildGraph renders it', () => {
    expect(hasConn(TEAM, WS, 'owns')).toBe(true);
  });
});

describe('work-graph vocabulary — workstream descriptor edges (#233)', () => {
  it('derives a has-priority edge from workstream.priority (scalar FK → priority)', () => {
    expect(hasEdge(WS, PRIO, 'has-priority')).toBe(true);
  });

  it('derives a structural edge from workstream.team (scalar FK → team)', () => {
    expect(hasEdge(WS, TEAM, 'structural')).toBe(true);
  });

  it('derives a tracked-in edge from workstream.systems-of-record (array FK → system-of-record)', () => {
    expect(hasEdge(WS, SOR, 'tracked-in')).toBe(true);
  });
});

describe('work-graph vocabulary — system-of-record kind (#233)', () => {
  it('emits a system-of-record node with correct cluster and entityType', () => {
    const sor = node(SOR);
    expect(sor.entityType).toBe('system-of-record');
    expect(sor.cluster).toBe('system-of-record');
    expect(sor.display).toBe('entity');
  });

  it('attaches sourceFile for F5 editor affordance', () => {
    const sor = node(SOR);
    expect(sor.sourceFile?.path).toMatch(/systems-of-record\/gh-issues\.yaml$/);
    expect(sor.sourceFile?.format).toBe('yaml');
  });

  it('keeps data verbatim (url, description pass through)', () => {
    const d = node(SOR).data as Record<string, unknown>;
    expect(d['@type']).toBe('system-of-record');
    expect(d.id).toBe('gh-issues');
    expect(typeof d.url).toBe('string');
  });
});

describe('work-graph vocabulary — priority kind (#233)', () => {
  it('already existed in the fixture and still emits a node', () => {
    const p = node(PRIO);
    expect(p.entityType).toBe('priority');
    expect(p.cluster).toBe('priority');
    expect(p.title).toBe('P0 — Latency');
  });
});

describe('work-graph vocabulary — person kind (#233)', () => {
  it('already existed and still emits a node with alias resolution', () => {
    const ada = node(ADA);
    expect(ada.entityType).toBe('person');
    expect((ada.data as Record<string, unknown>).alias).toBe('aokonkwo');
  });
});

describe('work-graph vocabulary — dangling reference validation (#233)', () => {
  it('stubs an unresolved team reference and emits an unresolved-ref diagnostic', () => {
    const src = withFiles({
      'workstreams/dangling.yaml': [
        '"@type": workstream',
        'id: dangling',
        'name: Dangling WS',
        'priority: p0-latency',
        'team: nonexistent-team',
        'systems-of-record: []',
      ].join('\n'),
    });
    const g = buildContentModel(src);
    const teamUrn = 'kg://xbox.com/teams/personalization/nonexistent-team';
    const stub = g.nodes.find(n => n.id === lid(teamUrn));
    expect(stub?.data?.unresolved).toBe(true);
    expect(g.diagnostics.some(d => d.code === 'unresolved-ref' && d.ref === teamUrn)).toBe(true);
  });

  it('stubs an unresolved system-of-record reference and emits a diagnostic', () => {
    const src = withFiles({
      'workstreams/missing-sor.yaml': [
        '"@type": workstream',
        'id: missing-sor',
        'name: Missing SoR WS',
        'priority: p0-latency',
        'systems-of-record:',
        '  - nonexistent-sor',
      ].join('\n'),
    });
    const g = buildContentModel(src);
    const sorUrn = 'kg://xbox.com/systems-of-record/nonexistent-sor';
    const stub = g.nodes.find(n => n.id === lid(sorUrn));
    expect(stub?.data?.unresolved).toBe(true);
    expect(g.diagnostics.some(d => d.code === 'unresolved-ref' && d.ref === sorUrn)).toBe(true);
  });

  it('stubs an unresolved team.lead alias and emits a diagnostic', () => {
    const src = withFiles({
      'teams/ghost-team.yaml': [
        '"@type": team',
        'id: ghost-team',
        'name: Ghost Team',
        'lead: nobody',
      ].join('\n'),
    });
    const g = buildContentModel(src);
    const ghostTeamUrn = 'kg://xbox.com/teams/personalization/ghost-team';
    const gt = g.nodes.find(n => n.id === lid(ghostTeamUrn));
    expect(gt).toBeDefined();
    expect(g.diagnostics.some(d => d.code === 'unresolved-ref')).toBe(true);
  });
});

describe('work-graph vocabulary — unknown kind validation (#233)', () => {
  it('emits an unknown-kind diagnostic for a file with an unregistered @type', () => {
    const src = withFiles({
      'teams/bad-kind.yaml': [
        '"@type": not-a-real-kind',
        'id: bad',
        'name: Bad',
      ].join('\n'),
    });
    const g = buildContentModel(src);
    expect(g.diagnostics.some(d => d.code === 'unknown-kind' && d.message.includes('not-a-real-kind'))).toBe(true);
  });
});

describe('work-graph vocabulary — org-scoping (#233)', () => {
  it('places default-org team flat (still carries org in URN)', () => {
    expect(nodeMap.has(lid(TEAM))).toBe(true);
    expect(TEAM).toContain('/personalization/');
  });

  it('places non-default-org team in nested subdir reflected in URN', () => {
    const src = withFiles({
      'teams/xcloud/cloud-ops.yaml': [
        '"@type": team',
        'id: cloud-ops',
        'name: Cloud Ops',
      ].join('\n'),
    });
    const g = buildContentModel(src);
    const xTeam = 'kg://xbox.com/teams/xcloud/cloud-ops';
    expect(g.nodes.some(n => n.id === lid(xTeam))).toBe(true);
  });

  it('system-of-record is authority-scoped (no org in URN)', () => {
    expect(SOR).toBe('kg://xbox.com/systems-of-record/gh-issues');
    expect(SOR).not.toContain('/personalization/');
  });
});

describe('work-graph vocabulary — inline object FK entries (#233 review)', () => {
  it('resolves an object systems-of-record entry via its string id', () => {
    const src = withFiles({
      'workstreams/obj-sor.yaml': [
        '"@type": workstream',
        'id: obj-sor',
        'name: Object SoR WS',
        'systems-of-record:',
        '  - id: gh-issues',
        '    name: GitHub Issues',
        '    url: "https://example.com"',
      ].join('\n'),
    });
    const g = buildContentModel(src);
    const ws = 'kg://xbox.com/workstreams/personalization/obj-sor';
    expect(g.edges.some(e => e.from === lid(ws) && e.to === lid(SOR) && e.relation === 'tracked-in')).toBe(true);
    expect(g.nodes.some(n => n.id.includes('[object Object]'))).toBe(false);
  });

  it('diagnoses an object entry without a string id (bad-ref-shape) instead of a garbage stub', () => {
    const src = withFiles({
      'workstreams/bad-sor.yaml': [
        '"@type": workstream',
        'id: bad-sor',
        'name: Bad SoR WS',
        'systems-of-record:',
        '  - name: No Id Here',
        '    url: "https://example.com"',
      ].join('\n'),
    });
    const g = buildContentModel(src);
    expect(g.diagnostics.some(d => d.code === 'bad-ref-shape')).toBe(true);
    expect(g.nodes.some(n => n.id.includes('[object Object]'))).toBe(false);
  });
});

describe('work-graph vocabulary — team alias identity (#233 review)', () => {
  it('teams are NOT addressable by their lead (no aliasField on team)', () => {
    // Two teams sharing a lead must not collide in the alias index, and a
    // scalar FK to a team must resolve by id only.
    const src = withFiles({
      'teams/second-team.yaml': [
        '"@type": team',
        'id: second-team',
        'name: Second Team',
        'lead: aokonkwo',
      ].join('\n'),
      'workstreams/by-lead.yaml': [
        '"@type": workstream',
        'id: by-lead',
        'name: By Lead WS',
        'team: aokonkwo',
      ].join('\n'),
    });
    const g = buildContentModel(src);
    const byLeadWs = 'kg://xbox.com/workstreams/personalization/by-lead';
    const aliasTarget = 'kg://xbox.com/teams/personalization/aokonkwo';
    // "aokonkwo" is not a team id → stub + unresolved-ref, NOT a silent hit on a team-by-lead alias
    expect(g.nodes.find(n => n.id === lid(aliasTarget))?.data?.unresolved).toBe(true);
    expect(g.edges.some(e => e.from === lid(byLeadWs) && e.to === lid(aliasTarget))).toBe(true);
    expect(g.diagnostics.some(d => d.code === 'unresolved-ref' && d.ref === aliasTarget)).toBe(true);
  });
});
