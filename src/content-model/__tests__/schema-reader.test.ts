import { describe, it, expect } from 'vitest';
import {
  readContentModelSchema,
  hasContentModelSource,
  buildUrn,
  resolveCurie,
  lifecycleBand,
  isOrgScoped,
} from '../schema-reader';
import type { Diagnostic } from '../types';
import { loadFixtureSource } from './fixtures';

const source = loadFixtureSource();
const { schema } = readContentModelSchema(source);

describe('schema reader (T2.1 / #160)', () => {
  it('detects a present content-model source (teamops + context)', () => {
    expect(hasContentModelSource(source)).toBe(true);
    expect(hasContentModelSource(null)).toBe(false);
    expect(hasContentModelSource({ root: 'x', files: {} })).toBe(false);
  });

  it('parses teamops identity (authority + default org)', () => {
    expect(schema.teamops.authority).toBe('xbox.com');
    expect(schema.teamops.defaultOrg).toBe('personalization');
    expect(schema.teamops.orgs.map(o => o.id)).toContain('xcloud');
  });

  it('reads URN bases from context.jsonld (none hardcoded)', () => {
    expect(schema.context.prefixes.squad).toBe('kg://xbox.com/squads/');
    expect(schema.context.prefixes.person).toBe('kg://xbox.com/people/');
    expect(schema.context.base).toBe('kg://xbox.com/');
  });

  it('resolves squad:game-assist → kg://xbox.com/squads/personalization/game-assist', () => {
    expect(resolveCurie(schema, 'squad:game-assist')).toBe(
      'kg://xbox.com/squads/personalization/game-assist',
    );
  });

  it('builds org-scoped vs authority-scoped URN shapes', () => {
    expect(isOrgScoped(schema, 'squad')).toBe(true);
    expect(isOrgScoped(schema, 'person')).toBe(false);
    // org-scoped → carries the org segment (explicit non-default org)
    expect(buildUrn(schema, 'squad', 'streaming', 'xcloud')).toBe(
      'kg://xbox.com/squads/xcloud/streaming',
    );
    // org-scoped → default org when none supplied
    expect(buildUrn(schema, 'squad', 'game-assist')).toBe(
      'kg://xbox.com/squads/personalization/game-assist',
    );
    // authority-scoped → no org segment
    expect(buildUrn(schema, 'person', 'ada')).toBe('kg://xbox.com/people/ada');
  });

  it('returns already-expanded URNs unchanged', () => {
    expect(resolveCurie(schema, 'kg://xbox.com/people/ada')).toBe('kg://xbox.com/people/ada');
  });

  it('diagnoses an unknown CURIE prefix', () => {
    const diagnostics: Diagnostic[] = [];
    expect(resolveCurie(schema, 'widget:foo', { diagnostics })).toBeNull();
    expect(diagnostics.some(d => d.code === 'unknown-prefix')).toBe(true);
  });

  it('looks up lifecycle bands by kind', () => {
    expect(lifecycleBand(schema, 'person')).toBe('durable');
    expect(lifecycleBand(schema, 'mission')).toBe('per-cycle');
    expect(lifecycleBand(schema, 'cycle')).toBe('per-cycle');
    expect(lifecycleBand(schema, 'nonexistent')).toBeUndefined();
  });

  it('parses edge rules, derived rules and deprecated rules', () => {
    expect(schema.edges.edges.find(e => e.id === 'squad-members')?.fk).toBe('array');
    expect(schema.edges.edges.find(e => e.id === 'mission-assignment')?.fk).toBe('composite');
    expect(schema.edges.derived[0].type).toBe('shared-target');
    expect(schema.edges.deprecated[0].relation).toBe('deprecated');
  });

  it('reads conventions with the type field never path-derived', () => {
    expect(schema.conventions.typeField).toBe('@type');
    expect(schema.conventions.idField).toBe('id');
    expect(schema.conventions.kinds.squad.path).toBe('squads');
    expect(schema.conventions.kinds.person.aliasField).toBe('alias');
  });
});
