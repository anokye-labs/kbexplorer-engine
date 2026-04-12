import type { KBNode, KBEdge, KBConfig, Connection } from '../types';

/** Result produced by a single provider run */
export interface ProviderResult {
  nodes: KBNode[];
  edges: KBEdge[];
}

/** A graph provider produces nodes and edges from a data source */
export interface GraphProvider {
  /** Unique provider identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider IDs this provider depends on (for ordering) */
  dependencies?: string[];
  /**
   * Resolve content from this provider.
   * @param config - the KB config
   * @param existingNodes - nodes from previously-run providers (for cross-referencing)
   */
  resolve(config: KBConfig, existingNodes: KBNode[]): Promise<ProviderResult>;
}

/** Provider registry — ordered collection of providers */
export class ProviderRegistry {
  private providers = new Map<string, GraphProvider>();

  register(provider: GraphProvider): void {
    this.providers.set(provider.id, provider);
  }

  /** Get providers in dependency-safe execution order */
  getExecutionOrder(): GraphProvider[] {
    const visited = new Set<string>();
    const order: GraphProvider[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const p = this.providers.get(id);
      if (!p) return;
      for (const dep of p.dependencies ?? []) visit(dep);
      order.push(p);
    };

    for (const id of this.providers.keys()) visit(id);
    return order;
  }

  get(id: string): GraphProvider | undefined {
    return this.providers.get(id);
  }
}
