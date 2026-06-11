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
import type { KBConfig, KBNode } from '../../types';
import type { ContentModelSource } from '../content-model';
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

  constructor(source: ContentModelSource | null | undefined) {
    this.source = source ?? null;
  }

  async resolve(_config: KBConfig, _existingNodes: KBNode[]): Promise<ProviderResult> {
    if (!hasContentModelSource(this.source)) {
      return { nodes: [], edges: [] };
    }
    // Register the spine node types + bespoke viewers before emitting nodes.
    registerContentModelTypes();
    const { nodes } = buildContentModel(this.source);
    // Edges are carried as node connections; the orchestrator ignores `edges`.
    return { nodes, edges: [] };
  }
}
