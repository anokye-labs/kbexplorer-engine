import type {
  GraphStore,
  GraphStoreCacheKey,
  GraphStoreEntry,
  GraphStoreInvalidation,
  GraphStoreWrite,
} from '@anokye-labs/kbexplorer-core';
import type { ProviderResult } from '../providers';

const NOT_IMPLEMENTED_MESSAGE =
  'sqlite-graph-store is not yet implemented in kbexplorer-engine — arrives in slice 5 (#472)';

/**
 * Temporary stub for the real sqlite-backed `GraphStore` (template's
 * `store/sqlite-graph-store.ts`, which layers on `sql.js` + `store/sqlite-runtime.ts`'s
 * WASM loader). That real implementation is deliberately deferred to slice 5 — it
 * depends on a WASM runtime shim that a parallel, separate engineering effort is
 * reworking for Node. This stub exists solely so `loader.ts`'s `mode === 'sqlite'`
 * branch type-checks and compiles against the same shape; every method throws.
 *
 * `VITE_KB_GRAPH_STORE=sqlite` is not set anywhere in template's CI/env today, so
 * this stub has zero live behavioral impact until slice 5 replaces it.
 */
export class SQLiteGraphStore<Value = ProviderResult> implements GraphStore<Value> {
  static async create<Value = ProviderResult>(
    _byteStore?: unknown,
  ): Promise<SQLiteGraphStore<Value>> {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }

  async get(_key: GraphStoreCacheKey): Promise<GraphStoreEntry<Value> | undefined> {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }

  async put(_entry: GraphStoreWrite<Value>): Promise<void> {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }

  async delete(_key: GraphStoreCacheKey): Promise<boolean> {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }

  async invalidate(_match: GraphStoreInvalidation): Promise<number> {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }
}
