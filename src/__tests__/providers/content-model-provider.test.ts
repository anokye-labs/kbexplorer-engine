import { describe, it, expect } from 'vitest';
import { ContentModelProvider } from '../../providers/content-model-provider';
import { resolveType } from '../../node-types';
import { registerBuiltinViewers, resolveViewer } from '../../../views/viewers';
import { SquadView } from '../../../views/viewers/SquadView';
import { PersonView } from '../../../views/viewers/PersonView';
import type { KBConfig } from '../../../types';
import { loadFixtureSource } from '../../content-model/__tests__/fixtures';

const config = {} as KBConfig;

describe('ContentModelProvider (T2.4 / #163)', () => {
  it('is a safe no-op when no content-model source is present', async () => {
    expect(await new ContentModelProvider(null).resolve(config, [])).toEqual({ nodes: [], edges: [] });
    expect(await new ContentModelProvider({ root: 'x', files: {} }).resolve(config, [])).toEqual({ nodes: [], edges: [] });
  });

  it('emits structured spine nodes with relationships as connections', async () => {
    const provider = new ContentModelProvider(loadFixtureSource());
    const { nodes, edges } = await provider.resolve(config, []);
    expect(nodes.length).toBeGreaterThan(0);
    // The orchestrator ignores provider edges — relationships ride on connections.
    expect(edges).toEqual([]);
    // Node ids are the LOCAL keys since #445 / AF-003; the canonical URN is
    // carried as `identity`.
    const squad = nodes.find(n => n.id === 'xbox.com/squads/personalization/game-assist');
    expect(squad?.identity).toBe('kg://xbox.com/squads/personalization/game-assist');
    expect(squad?.connections.some(c => c.relation === 'staffs')).toBe(true);
    expect(squad?.entityType).toBe('squad');
    expect(squad?.display).toBe('entity');
  });

  it('registers spine node types + bespoke viewers on resolve', async () => {
    registerBuiltinViewers();
    const provider = new ContentModelProvider(loadFixtureSource());
    const { nodes } = await provider.resolve(config, []);
    expect(resolveType('squad')?.layer).toBe('work');
    expect(resolveType('person')?.viewer).toBe('person');

    const squad = nodes.find(n => n.entityType === 'squad')!;
    const person = nodes.find(n => n.entityType === 'person')!;
    expect(resolveViewer(squad)).toBe(SquadView);
    expect(resolveViewer(person)).toBe(PersonView);
  });
});
