/**
 * Public `./store` subpath — slice 3/5 of the kbexplorer-template ->
 * kbexplorer-engine migration (anokye-labs/kbexplorer-template#472, epic #463).
 *
 * Replaces the scaffold's `StorePlaceholder`/`sqliteProviderResultStore`
 * placeholders with the real graph-store config + content-fingerprinting +
 * provider-result-store orchestration modules (forward-moved from nominal
 * slice 4/5 scope; see PR body for the judgment call). The sqlite-backed
 * `GraphStore` implementation itself (`store/sqlite-graph-store.ts`) is
 * intentionally NOT exported here yet — it's a throw-stub until slice 5.
 */

// -- store/config.ts ----------------------------------------------------------
export { resolveGraphStoreOptions, isGraphStoreEnabled } from './store/config';
export type { GraphStoreMode, GraphStoreOptions } from './store/config';

// -- store/fingerprint.ts -------------------------------------------------------
export {
  buildProviderResultCacheKey,
  GRAPH_STORE_DERIVATION_VERSION,
  GRAPH_STORE_PROVIDER_ID,
} from './store/fingerprint';

// -- store/store-orchestrator.ts ------------------------------------------------
export { orchestrateWithProviderResultStore } from './store/store-orchestrator';
export type { ProviderCacheKeyBuilder } from './store/store-orchestrator';
