/**
 * Public `./store` subpath — slice 3/5 of the kbexplorer-template ->
 * kbexplorer-engine migration (anokye-labs/kbexplorer-template#472, epic #463).
 *
* Replaces the scaffold's placeholder store surface with the real graph-store
* config, content-fingerprinting, orchestration, and sqlite-backed runtime
* modules that are used by the engine loader.
*/

// -- store/config.ts ----------------------------------------------------------
export { resolveGraphStoreOptions, isGraphStoreEnabled } from './store/config';
export type { GraphStoreMode, GraphStoreOptions } from './store/config';

// -- store/sqlite-graph-store.ts ----------------------------------------------
export { SQLiteGraphStore } from './store/sqlite-graph-store';

// -- store/sqlite-runtime.ts --------------------------------------------------
export { IndexedDbSqliteByteStore, MemorySqliteByteStore, loadSqlJs, openPersistedDatabase } from './store/sqlite-runtime';
export type { SqliteByteStore } from './store/sqlite-runtime';

// -- store/fingerprint.ts -------------------------------------------------------
export {
 buildProviderResultCacheKey,
 GRAPH_STORE_DERIVATION_VERSION,
 GRAPH_STORE_PROVIDER_ID,
} from './store/fingerprint';

// -- store/store-orchestrator.ts ------------------------------------------------
export { orchestrateWithProviderResultStore } from './store/store-orchestrator';
export type { ProviderCacheKeyBuilder } from './store/store-orchestrator';
