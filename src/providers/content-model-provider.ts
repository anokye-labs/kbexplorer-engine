/**
 * ContentModelProvider (F2 / T2.2 + T2.4 — issues #161, #163).
 *
 * Wraps the schema-driven {@link buildContentModel} pipeline as a
 * {@link GraphProvider}. Relationships are emitted as `connections` on the source
 * nodes (the orchestrator ignores a provider's `edges` and `buildGraph` derives
 * edges from `connections`), so the resolved edges render in the graph.
 *
 * **Safe no-op when no content-model source is present** — it returns no nodes,
 * so existing graphs (this repo has no content-model source) are unchanged.
 */
import type { GraphProvider, ProviderResult } from '../providers';
import type { KBConfig, KBNode } from '@anokye-labs/kbexplorer-core';
import type { ContentModelSource, VocabularyOverlay } from '../content-model';
import {
  CONTENT_MODEL_PROVIDER,
  buildContentModel,
  hasContentModelSource,
  registerContentModelTypes,
} from '../content-model';

export class ContentModelProvider implements GraphProvider {
  id = CONTENT_MODEL_PROVIDER;
  name = 'Content Model';
  dependencies: string[] = [];

  private source: ContentModelSource | null;
  /**
   * Optional cross-repo synonym overlay (#153) supplied independently of the
   * source's own files — the shared vocabulary layer. Null/absent leaves the
   * synonym layer a safe no-op.
   */
  private vocabularyOverlay: VocabularyOverlay;

  constructor(source: ContentModelSource | null | undefined, vocabularyOverlay?: VocabularyOverlay) {
    this.source = source ?? null;
    this.vocabularyOverlay = vocabularyOverlay ?? null;
  }

  async resolve(_config: KBConfig, _existingNodes: KBNode[]): Promise<ProviderResult> {
    if (!hasContentModelSource(this.source)) {
      return { nodes: [], edges: [] };
    }
    // Register the spine node types + bespoke viewers before emitting nodes.
    registerContentModelTypes();
    const { nodes } = buildContentModel(this.source, this.vocabularyOverlay);

    // Anchor every content-model entity to the repository where its source
    // files live. Without this every kg:// entity floats as its own island
    // (or as a small cluster of mutually-linked entities) with no path back
    // to the main graph — the user sees "Disconnected node" tooltips on
    // people, squads, priorities, missions, etc.
    //
    // The repo-meta node may or may not exist (e.g. authored-only mode),
    // so we record the connection unconditionally: the engine drops edges
    // whose target isn't in the final nodeMap (see graph.ts:55).
    // Anchor every content-model entity to the repository where its source
    // files live AND fold its cluster into a single `teamops` legend entry.
    //
    // Without anchoring: every kg:// entity floats as its own island (or as
    // a small cluster of mutually-linked entities) with no path back to the
    // main graph — the user sees "Disconnected node" tooltips on people,
    // squads, priorities, missions, etc.
    //
    // Without cluster folding: each kind (person / squad / priority /
    // workstream / cycle / mission / org / team / system-of-record /
    // service / decision) becomes its own 1-5 node singleton cluster and the
    // legend fragments. The
    // entity's native kind is preserved in `data.@type` and `entityType`
    // for typed-viewer routing, so the fold is purely cosmetic.
    //
    // The repo-meta node may or may not exist (e.g. authored-only mode), so
    // we record the connection unconditionally: the engine drops edges
    // whose target isn't in the final nodeMap (see graph.ts:55).
    const anchored = nodes.map((n) => ({
      ...n,
      cluster: 'teamops',
      connections: [
        ...n.connections,
        {
          to: 'repo-meta',
          type: 'references' as const,
          relation: 'tracked-in',
          description: 'Tracked in this repository',
          source: 'inferred' as const,
        },
      ],
    }));

    // Edges are carried as node connections; the orchestrator ignores `edges`.
    return { nodes: anchored, edges: [] };
  }
}
