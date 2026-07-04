// TEMPORARY: slice 5 will replace this stub with the real SQLite-backed graph store.
// This placeholder exists so the loader can typecheck and import the lazy store module
// while the slice-5 implementation is developed separately.

import type { GraphStore, GraphStoreCacheKey, GraphStoreEntry, GraphStoreInvalidation, GraphStoreWrite } from '@anokye-labs/kbexplorer-core';
import type { ProviderResult } from '../providers';

export class SQLiteGraphStore implements GraphStore<ProviderResult> {
  static async create(): Promise<SQLiteGraphStore> {
    throw new Error('SQLiteGraphStore arrives in slice 5 -- see #472');
  }

  async get(_key: GraphStoreCacheKey): Promise<GraphStoreEntry<ProviderResult> | undefined> {
    throw new Error('SQLiteGraphStore arrives in slice 5 -- see #472');
  }

  async put(_entry: GraphStoreWrite<ProviderResult>): Promise<void> {
    throw new Error('SQLiteGraphStore arrives in slice 5 -- see #472');
  }

  async delete(_key: GraphStoreCacheKey): Promise<boolean> {
    throw new Error('SQLiteGraphStore arrives in slice 5 -- see #472');
  }

  async invalidate(_match: GraphStoreInvalidation): Promise<number> {
    throw new Error('SQLiteGraphStore arrives in slice 5 -- see #472');
  }
}
