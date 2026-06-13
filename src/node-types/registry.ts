/**
 * Node-type registry — the open, data-driven core of the node-type engine.
 *
 * Each node type declares how it participates in the graph: its layer, default
 * cluster, the relations it tends to emit, and which viewer renders it. The
 * registry is consulted by {@link getNodeLayer} (via {@link resolveNodeLayer})
 * and by cluster/legend logic, so adding a brand-new node type requires only a
 * `registerType` call — no edits to the core discriminated unions or render
 * switches.
 *
 * Implementation note: this module imports from `../../types` **type-only**, so
 * there is no runtime import cycle even though `types/index.ts` imports
 * {@link resolveNodeLayer} from here at runtime.
 */
import type { KBNode, NodeLayer } from '../../types';

/** A registered node type and how it participates in the graph. */
export interface NodeTypeDefinition {
  /** Type id — matches a node's `entityType` or, for built-ins, its `source.type`. */
  id: string;
  /** Human-readable label (defaults to a humanized id). */
  label?: string;
  /** Graph layer this type belongs to. Defaults to `'file'` when unset. */
  layer?: NodeLayer;
  /** Default cluster id for nodes of this type (used when a node omits its cluster). */
  cluster?: string;
  /** Relation kinds this type commonly emits (informational; surfaced to the legend). */
  relations?: string[];
  /**
   * Viewer key used to resolve a renderer from the viewer registry. Defaults to
   * the type `id`. The viewer registry falls back to the generic viewer when no
   * component is registered for the key.
   */
  viewer?: string;
  /** Short description of the type (documentation aid). */
  description?: string;
  /**
   * Optional discovery hook — given raw upstream records, decide which become
   * nodes of this type. Reserved for content-model ingestion (F2/F3); the
   * foundation only stores it.
   */
  discover?: (records: unknown[]) => unknown[];
  /**
   * Optional mapping hook — turn a single upstream record into a partial node.
   * Reserved for ingestion (F2/F3); the foundation only stores it.
   */
  map?: (record: unknown) => Partial<KBNode>;
}

const registry = new Map<string, NodeTypeDefinition>();

/**
 * Built-in source types and their historical layer mapping. Registering these
 * keeps {@link getNodeLayer} byte-identical to the previous hardcoded switch.
 */
const BUILT_IN_NODE_TYPES: NodeTypeDefinition[] = [
  { id: 'authored', layer: 'content', label: 'Authored' },
  { id: 'readme', layer: 'content', label: 'README' },
  { id: 'derived', layer: 'content', label: 'Derived' },
  { id: 'section', layer: 'content', label: 'Section' },
  { id: 'structured', layer: 'content', label: 'Structured' },
  { id: 'issue', layer: 'work', label: 'Issue' },
  { id: 'pull_request', layer: 'work', label: 'Pull Request' },
  { id: 'commit', layer: 'work', label: 'Commit' },
  { id: 'branch', layer: 'work', label: 'Branch' },
  { id: 'workflow', layer: 'work', label: 'Workflow' },
  { id: 'repository', layer: 'work', label: 'Repository' },
  { id: 'release', layer: 'work', label: 'Release', cluster: 'releases', description: 'A GitHub release (tag, name, release notes).' },
  { id: 'file', layer: 'file', label: 'File' },
  { id: 'external', layer: 'file', label: 'External' },
];

/** Register (or replace) a node type. */
export function registerType(def: NodeTypeDefinition): void {
  registry.set(def.id, def);
}

/** Resolve a node type by id. Returns `undefined` for unknown ids. */
export function resolveType(id: string | undefined): NodeTypeDefinition | undefined {
  if (!id) return undefined;
  return registry.get(id);
}

/** Whether a node type id is registered. */
export function hasType(id: string): boolean {
  return registry.has(id);
}

/** All registered node types. */
export function getRegisteredTypes(): NodeTypeDefinition[] {
  return [...registry.values()];
}

/** (Re)register the built-in source types. Idempotent. */
export function registerBuiltInNodeTypes(): void {
  for (const def of BUILT_IN_NODE_TYPES) {
    if (!registry.has(def.id)) registry.set(def.id, def);
  }
}

/** Clear the registry back to just the built-ins. Intended for tests. */
export function resetNodeTypeRegistry(): void {
  registry.clear();
  registerBuiltInNodeTypes();
}

/**
 * Resolve a node's graph layer via the registry.
 *
 * Precedence: the node's `entityType` definition → its `source.type`
 * definition → `'file'`. This preserves the historical mapping for built-in
 * source types while letting registered entity types override the layer.
 */
export function resolveNodeLayer(node: KBNode): NodeLayer {
  const byEntity = node.entityType ? registry.get(node.entityType) : undefined;
  if (byEntity?.layer) return byEntity.layer;
  const bySource = registry.get(node.source.type);
  if (bySource?.layer) return bySource.layer;
  return 'file';
}

/**
 * Resolve the default cluster for a node from its type, when the node does not
 * already declare one. Returns `undefined` when nothing is registered.
 */
export function resolveTypeCluster(
  node: Pick<KBNode, 'entityType'> & { source: { type: string } },
): string | undefined {
  const byEntity = node.entityType ? registry.get(node.entityType) : undefined;
  if (byEntity?.cluster) return byEntity.cluster;
  return registry.get(node.source.type)?.cluster;
}

// Register built-ins on first import so resolution works before any caller
// registers custom types.
registerBuiltInNodeTypes();
