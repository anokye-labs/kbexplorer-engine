/**
 * Public API for the node-type engine.
 *
 * Importing this module guarantees the built-in node types are registered.
 * Custom types can be added at runtime via {@link registerType} without
 * touching the core discriminated unions.
 */
export type { NodeTypeDefinition } from './registry';
export {
  registerType,
  resolveType,
  hasType,
  getRegisteredTypes,
  registerBuiltInNodeTypes,
  resetNodeTypeRegistry,
  resolveNodeLayer,
  resolveTypeCluster,
} from './registry';
