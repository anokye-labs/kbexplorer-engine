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
import { registerViewer, type ViewerComponent } from '../../views/viewers';
import { PersonView } from '../../views/viewers/PersonView';
import { SquadView } from '../../views/viewers/SquadView';
import { WorkstreamView } from '../../views/viewers/WorkstreamView';
import { MissionView } from '../../views/viewers/MissionView';
import { PriorityView } from '../../views/viewers/PriorityView';
import { CycleView } from '../../views/viewers/CycleView';
import { OrgView } from '../../views/viewers/OrgView';
import { TeamView } from '../../views/viewers/TeamView';
import { SystemOfRecordView } from '../../views/viewers/SystemOfRecordView';
import { ServiceView } from '../../views/viewers/ServiceView';
import { DecisionView } from '../../views/viewers/DecisionView';

interface SpineKind {
  id: string;
  label: string;
  layer: NodeLayer;
  relations: string[];
  view: ViewerComponent;
  description: string;
}

/** The content-model spine kinds and the viewer each resolves to. */
export const CONTENT_MODEL_KINDS: SpineKind[] = [
  { id: 'person', label: 'Person', layer: 'work', relations: ['reports-to'], view: PersonView, description: 'An individual in the org.' },
  { id: 'squad', label: 'Squad', layer: 'work', relations: ['leads', 'staffs', 'structural', 'deprecated'], view: SquadView, description: 'A squad that staffs people, is led by a DRI, and delivers a workstream.' },
  { id: 'workstream', label: 'Workstream', layer: 'work', relations: ['structural'], view: WorkstreamView, description: 'A stream of work aligned to a priority.' },
  { id: 'mission', label: 'Mission', layer: 'work', relations: ['structural'], view: MissionView, description: 'A time-boxed mission assigned to a cycle + squad.' },
  { id: 'priority', label: 'Priority', layer: 'work', relations: [], view: PriorityView, description: 'A ranked organizational priority.' },
  { id: 'cycle', label: 'Cycle', layer: 'work', relations: [], view: CycleView, description: 'A planning cycle (time box).' },
  { id: 'org', label: 'Org', layer: 'work', relations: [], view: OrgView, description: 'An organization with a charter.' },
  // Work-graph organizational-layer descriptor kinds (#233)
  { id: 'team', label: 'Team', layer: 'work', relations: ['leads', 'staffs', 'owns'], view: TeamView, description: 'A team that leads people and owns workstreams.' },
  { id: 'system-of-record', label: 'System of Record', layer: 'work', relations: ['tracked-in'], view: SystemOfRecordView, description: 'An external system that tracks a workstream (e.g. an ADO board or GitHub repo).' },
  // Services-monorepo core kinds (#275)
  { id: 'service', label: 'Service', layer: 'work', relations: ['owned-by', 'tracked-in'], view: ServiceView, description: 'A deployable service owned by a team, with a ServiceTree id and catalog-info path.' },
  { id: 'decision', label: 'Decision', layer: 'work', relations: ['decided-by', 'affects'], view: DecisionView, description: 'An architecture decision record (ADR) — deciders, status, context, and the work it affects.' },
];

/** Register every spine node type + its bespoke viewer. Idempotent. */
export function registerContentModelTypes(): void {
  for (const k of CONTENT_MODEL_KINDS) {
    registerType({
      id: k.id,
      label: k.label,
      layer: k.layer,
      cluster: k.id,
      relations: k.relations,
      viewer: k.id,
      description: k.description,
    });
    registerViewer(k.id, k.view);
  }
}
