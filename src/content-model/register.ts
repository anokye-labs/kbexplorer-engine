/**
 * Content-model registration hook (F2 / T2.5 + T2.6 — issues #164, #165).
 *
 * Registers the spine node types (Person, Squad, Workstream, Mission, Priority,
 * Cycle, Org) in the node-type registry and binds each to its bespoke viewer in
 * the viewer registry. Both registries are open seams, so this adds the kinds
 * without touching any core union or render switch.
 *
 * Idempotent: registering the same id twice replaces the prior entry.
 */
import type { NodeLayer } from '../../types';
import { registerType } from '../node-types';

interface SpineKind {
  id: string;
  label: string;
  layer: NodeLayer;
  relations: string[];
  viewer: string;
  description: string;
}

/** The content-model spine kinds and the viewer each resolves to. */
export const CONTENT_MODEL_KINDS: SpineKind[] = [
  { id: 'person', label: 'Person', layer: 'work', relations: ['reports-to'], viewer: 'person', description: 'An individual in the org.' },
  { id: 'squad', label: 'Squad', layer: 'work', relations: ['leads', 'staffs', 'structural', 'deprecated'], viewer: 'squad', description: 'A squad that staffs people, is led by a DRI, and delivers a workstream.' },
  { id: 'workstream', label: 'Workstream', layer: 'work', relations: ['structural'], viewer: 'workstream', description: 'A stream of work aligned to a priority.' },
  { id: 'mission', label: 'Mission', layer: 'work', relations: ['structural'], viewer: 'mission', description: 'A time-boxed mission assigned to a cycle + squad.' },
  { id: 'priority', label: 'Priority', layer: 'work', relations: [], viewer: 'priority', description: 'A ranked organizational priority.' },
  { id: 'cycle', label: 'Cycle', layer: 'work', relations: [], viewer: 'cycle', description: 'A planning cycle (time box).' },
  { id: 'org', label: 'Org', layer: 'work', relations: [], viewer: 'org', description: 'An organization with a charter.' },
  // Work-graph organizational-layer descriptor kinds (#233)
  { id: 'team', label: 'Team', layer: 'work', relations: ['leads', 'staffs', 'owns'], viewer: 'team', description: 'A team that leads people and owns workstreams.' },
  { id: 'system-of-record', label: 'System of Record', layer: 'work', relations: ['tracked-in'], viewer: 'system-of-record', description: 'An external system that tracks a workstream (e.g. an ADO board or GitHub repo).' },
  // Services-monorepo core kinds (#275)
  { id: 'service', label: 'Service', layer: 'work', relations: ['owned-by', 'tracked-in'], viewer: 'service', description: 'A deployable service owned by a team, with a ServiceTree id and catalog-info path.' },
  { id: 'decision', label: 'Decision', layer: 'work', relations: ['decided-by', 'affects'], viewer: 'decision', description: 'An architecture decision record (ADR) — deciders, status, context, and the work it affects.' },
];

/** Register every spine node type + its bespoke viewer name. Idempotent. */
export function registerContentModelTypes(): void {
  for (const k of CONTENT_MODEL_KINDS) {
    registerType({
      id: k.id,
      label: k.label,
      layer: k.layer,
      cluster: k.id,
      relations: k.relations,
      viewer: k.viewer,
      description: k.description,
    });
  }
}
