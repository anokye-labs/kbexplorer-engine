/**
 * Content-model ingestion (F2 — issue #149).
 *
 * Public surface for the schema-driven content-model pipeline:
 * - {@link readContentModelSchema} + identity helpers (T2.1 / #160)
 * - {@link buildContentModel} 5-pass builder (T2.2 + T2.3 / #161, #162)
 * - {@link registerContentModelTypes} node-type + viewer registration (#164, #165)
 *
 * Everything is a **safe no-op** when no content-model source is present.
 */
export * from './types';
export {
  SCHEMA_PATHS,
  hasContentModelSource,
  readContentModelSchema,
  buildUrn,
  resolveCurie,
  canonicalKind,
  lifecycleBand,
  getConvention,
  isOrgScoped,
} from './schema-reader';
export {
  CONTENT_MODEL_PROVIDER,
  buildContentModel,
  type ContentModelGraph,
} from './builder';
export {
  CONTENT_MODEL_KINDS,
  registerContentModelTypes,
} from './register';
