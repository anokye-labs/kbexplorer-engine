/**
 * Service + Decision content-model kinds (Feature H — issue #275).
 *
 * Hermetic: extends the shared fixture tree (whose schema already declares the
 * `service` and `decision` kinds, their conventions, edge rules, lifecycle bands
 * and context prefixes) with a couple of inline entity files, then asserts the
 * builder resolves every FK cleanly. Covers:
 *  - service node emission (kind, cluster, durable lifecycle, sourceFile)
 *  - service `owned-by` → team, `tracked-in` → system-of-record edges
 *  - decision node emission (per-event lifecycle)
 *  - decision `decided-by` → person[] edges
 *  - decision `affects` → workstream[] AND mission[] edges (two-field split)
 *  - no stubs / unresolved-ref diagnostics on the happy path
 *  - a literal single `affects` field is intentionally NOT wired
 */
import { describe, it, expect } from 'vitest';
import { buildContentModel } from '../builder';
import { urnLocalId } from '../schema-reader';
import type { KBEdge } from '@anokye-labs/kbexplorer-core';
import { loadFixtureSource } from './fixtures';
import type { ContentModelSource } from '../types';

// ── URN constants ──────────────────────────────────────────────────────────────

const SERVICE  = 'kg://xbox.com/services/kb-explorer-web';
const DECISION = 'kg://xbox.com/decisions/adr-001';
const TEAM     = 'kg://xbox.com/teams/personalization/graph-platform';
const SOR      = 'kg://xbox.com/systems-of-record/gh-issues';
const ADA      = 'kg://xbox.com/people/ada';
const BEN      = 'kg://xbox.com/people/ben';
const WS       = 'kg://xbox.com/workstreams/personalization/personalization-discovery';
const MISSION  = 'kg://xbox.com/missions/personalization/q1-uplift';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const base = loadFixtureSource();

function withFiles(extra: Record<string, string>): ContentModelSource {
  return { root: base.root, files: { ...base.files, ...extra } };
}

const SERVICE_YAML = [
  '"@type": service',
  'id: kb-explorer-web',
  'name: KB Explorer Web',
  'description: Static web frontend.',
  'team: graph-platform',
  'serviceTreeId: 7e4a1c20-91a2-4d3e-9f0b-2c6d8e1a4b55',
  'serviceTreeUrl: "https://servicetree.msftcloudes.com/#/svc/7e4a1c20"',
  'catalogInfoPath: services/kb-explorer-web/catalog-info.yaml',
  'repoPath: anokye-labs/kbexplorer-template',
  'systems-of-record:',
  '  - gh-issues',
].join('\n');

const DECISION_YAML = [
  '"@type": decision',
  'id: adr-001',
  'name: "ADR-001: Adopt a schema-driven content model"',
  'status: accepted',
  'date: 2026-02-12',
  'context: The spine was hardcoded per org.',
  'deciders:',
  '  - ada',
  '  - ben',
  'affects-workstreams:',
  '  - personalization-discovery',
  'affects-missions:',
  '  - q1-uplift',
].join('\n');

const source = withFiles({
  'services/kb-explorer-web.yaml': SERVICE_YAML,
  'decisions/adr-001.yaml': DECISION_YAML,
});

const graph = buildContentModel(source);
// Nodes are keyed by their LOCAL id (`urnLocalId(urn)`), distinct from the
// canonical identity URN since #445 / AF-003; helpers convert from the URN
// constants above.
const lid = urnLocalId;
const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
const byUrn = (urn: string) => nodeMap.get(lid(urn));

function hasEdge(from: string, to: string, relation: string): boolean {
  return graph.edges.some((e: KBEdge) => e.from === lid(from) && e.to === lid(to) && e.relation === relation);
}
function hasConn(fromUrn: string, toUrn: string, relation: string): boolean {
  return byUrn(fromUrn)?.connections.some(c => c.to === lid(toUrn) && c.relation === relation) ?? false;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('service kind (#275)', () => {
  it('emits a service node with @type=service, cluster=service, display=entity', () => {
    const s = byUrn(SERVICE);
    expect(s).toBeDefined();
    expect(s!.entityType).toBe('service');
    expect(s!.cluster).toBe('service');
    expect(s!.display).toBe('entity');
    expect(s!.provider).toBe('content-model');
  });

  it('is authority-scoped (no org segment in the URN)', () => {
    expect(SERVICE).not.toContain('/personalization/');
  });

  it('gets the durable lifecycle band', () => {
    expect(byUrn(SERVICE)!.jsonld?.lifecycle).toBe('durable');
  });

  it('keeps catalog identity fields verbatim in data', () => {
    const d = byUrn(SERVICE)!.data as Record<string, unknown>;
    expect(d.serviceTreeId).toBe('7e4a1c20-91a2-4d3e-9f0b-2c6d8e1a4b55');
    expect(d.catalogInfoPath).toBe('services/kb-explorer-web/catalog-info.yaml');
    expect(d.repoPath).toBe('anokye-labs/kbexplorer-template');
  });

  it('attaches sourceFile so the F5 editor affordance lights up', () => {
    const s = byUrn(SERVICE)!;
    expect(s.sourceFile?.path).toMatch(/services\/kb-explorer-web\.yaml$/);
    expect(s.sourceFile?.format).toBe('yaml');
  });

  it('resolves service.team → team via an owned-by edge (scalar FK)', () => {
    expect(hasEdge(SERVICE, TEAM, 'owned-by')).toBe(true);
    expect(hasConn(SERVICE, TEAM, 'owned-by')).toBe(true);
    // the team is a real, resolved node — not a stub
    expect(byUrn(TEAM)!.data?.unresolved).toBeUndefined();
  });

  it('resolves service.systems-of-record → system-of-record via tracked-in edges (array FK)', () => {
    expect(hasEdge(SERVICE, SOR, 'tracked-in')).toBe(true);
    expect(byUrn(SOR)!.data?.unresolved).toBeUndefined();
  });
});

describe('decision kind (#275)', () => {
  it('emits a decision node with @type=decision, cluster=decision, display=entity', () => {
    const d = byUrn(DECISION);
    expect(d).toBeDefined();
    expect(d!.entityType).toBe('decision');
    expect(d!.cluster).toBe('decision');
    expect(d!.display).toBe('entity');
  });

  it('gets the per-event lifecycle band', () => {
    expect(byUrn(DECISION)!.jsonld?.lifecycle).toBe('per-event');
  });

  it('resolves decision.deciders → person[] via decided-by edges (array FK)', () => {
    expect(hasEdge(DECISION, ADA, 'decided-by')).toBe(true);
    expect(hasEdge(DECISION, BEN, 'decided-by')).toBe(true);
    expect(hasConn(DECISION, ADA, 'decided-by')).toBe(true);
  });

  it('resolves decision.affects-workstreams → workstream via an affects edge', () => {
    expect(hasEdge(DECISION, WS, 'affects')).toBe(true);
    expect(byUrn(WS)!.data?.unresolved).toBeUndefined();
  });

  it('resolves decision.affects-missions → mission via an affects edge', () => {
    expect(hasEdge(DECISION, MISSION, 'affects')).toBe(true);
    expect(byUrn(MISSION)!.data?.unresolved).toBeUndefined();
  });
});

describe('service + decision — clean resolution (#275)', () => {
  it('produces no unresolved-ref diagnostics for any service/decision target', () => {
    const offending = graph.diagnostics.filter(
      d => d.code === 'unresolved-ref'
        && [TEAM, SOR, ADA, BEN, WS, MISSION].includes(d.ref ?? ''),
    );
    expect(offending).toEqual([]);
  });

  it('creates no stub nodes for the service/decision targets', () => {
    for (const urn of [TEAM, SOR, ADA, BEN, WS, MISSION]) {
      expect(byUrn(urn)?.data?.unresolved).toBeUndefined();
    }
  });
});

describe('decision — literal `affects` field is not wired (#275)', () => {
  it('a single `affects` field produces no affects edge (two-field split is intentional)', () => {
    const src = withFiles({
      'decisions/literal-affects.yaml': [
        '"@type": decision',
        'id: literal-affects',
        'name: Literal Affects ADR',
        'affects:',
        '  - personalization-discovery',
      ].join('\n'),
    });
    const g = buildContentModel(src);
    const urn = 'kg://xbox.com/decisions/literal-affects';
    expect(g.nodes.some(n => n.id === lid(urn))).toBe(true);
    expect(g.edges.some(e => e.from === lid(urn) && e.relation === 'affects')).toBe(false);
  });
});
