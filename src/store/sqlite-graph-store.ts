import type { Database, ParamsObject } from 'sql.js';
import type {
  GraphStore,
  GraphStoreCacheKey,
  GraphStoreEntry,
  GraphStoreInvalidation,
  GraphStoreWrite,
} from '@anokye-labs/kbexplorer-core';
import {
  GRAPH_STORE_API_VERSION,
  GRAPH_STORE_CACHE_KEY_VERSION,
  formatContentHash,
  formatGraphStoreCacheKey,
} from '@anokye-labs/kbexplorer-core';
import type { ProviderResult } from '../providers';
import { GRAPH_STORE_DERIVATION_VERSION } from './fingerprint';
import { openPersistedDatabase, type SqliteByteStore } from './sqlite-runtime';

const SQLITE_SCHEMA_VERSION = 'sqlite-graph-store-v1';

interface EntryRow {
  cache_key: string;
  key_json: string;
  value_json: string;
  dependencies_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export class SQLiteGraphStore<Value = ProviderResult> implements GraphStore<Value> {
  private readonly db: Database;
  private readonly persist: () => Promise<void>;

  private constructor(db: Database, persist: () => Promise<void>) {
    this.db = db;
    this.persist = persist;
    this.migrate();
  }

  static async create<Value = ProviderResult>(
    byteStore?: SqliteByteStore,
    locateFile?: (file: string) => string,
  ): Promise<SQLiteGraphStore<Value>> {
    const { db, persist } = await openPersistedDatabase(byteStore, locateFile);
    return new SQLiteGraphStore<Value>(db, persist);
  }

  async get(key: GraphStoreCacheKey): Promise<GraphStoreEntry<Value> | undefined> {
    const row = this.selectEntry(formatGraphStoreCacheKey(key));
    if (!row) return undefined;
    const entry = rowToEntry<Value>(row);
    if (formatGraphStoreCacheKey(entry.key) !== formatGraphStoreCacheKey(key)) {
      return undefined;
    }
    return entry;
  }

  async put(entry: GraphStoreWrite<Value>): Promise<void> {
    const now = new Date().toISOString();
    const createdAt = entry.createdAt ?? now;
    const updatedAt = entry.updatedAt ?? now;
    this.db.run(
      `insert into entries (
        cache_key, key_json, scope, provider_id, source_id, variant, content_hash,
        value_json, dependencies_json, metadata_json, created_at, updated_at
      ) values (
        $cache_key, $key_json, $scope, $provider_id, $source_id, $variant, $content_hash,
        $value_json, $dependencies_json, $metadata_json, $created_at, $updated_at
      )
      on conflict(cache_key) do update set
        key_json = excluded.key_json,
        scope = excluded.scope,
        provider_id = excluded.provider_id,
        source_id = excluded.source_id,
        variant = excluded.variant,
        content_hash = excluded.content_hash,
        value_json = excluded.value_json,
        dependencies_json = excluded.dependencies_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`,
      {
        $cache_key: formatGraphStoreCacheKey(entry.key),
        $key_json: JSON.stringify(entry.key),
        $scope: entry.key.scope,
        $provider_id: entry.key.providerId,
        $source_id: entry.key.sourceId ?? null,
        $variant: entry.key.variant ?? null,
        $content_hash: formatContentHash(entry.key.contentHash),
        $value_json: JSON.stringify(entry.value),
        $dependencies_json: JSON.stringify(entry.dependencies ?? []),
        $metadata_json: JSON.stringify(entry.metadata ?? {}),
        $created_at: createdAt,
        $updated_at: updatedAt,
      } satisfies ParamsObject,
    );
    await this.persist();
  }

  async delete(key: GraphStoreCacheKey): Promise<boolean> {
    const cacheKey = formatGraphStoreCacheKey(key);
    const before = this.countEntries();
    this.db.run('delete from entries where cache_key = $cache_key', { $cache_key: cacheKey });
    const deleted = this.countEntries() < before;
    if (deleted) await this.persist();
    return deleted;
  }

  async invalidate(match: GraphStoreInvalidation): Promise<number> {
    const rows = this.selectEntries();
    let deleted = 0;
    for (const row of rows) {
      const entry = rowToEntry<Value>(row);
      if (matchesInvalidation(entry, match)) {
        this.db.run('delete from entries where cache_key = $cache_key', { $cache_key: row.cache_key });
        deleted++;
      }
    }
    if (deleted > 0) await this.persist();
    return deleted;
  }

  private migrate(): void {
    this.db.run(`
      create table if not exists metadata (
        key text primary key,
        value text not null
      );
      create table if not exists entries (
        cache_key text primary key,
        key_json text not null,
        scope text not null,
        provider_id text not null,
        source_id text,
        variant text,
        content_hash text not null,
        value_json text not null,
        dependencies_json text not null,
        metadata_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create index if not exists idx_entries_scope on entries(scope);
      create index if not exists idx_entries_provider on entries(provider_id);
      create index if not exists idx_entries_source on entries(source_id);
      create index if not exists idx_entries_variant on entries(variant);
      create index if not exists idx_entries_content_hash on entries(content_hash);
    `);
    this.setMetadata('sqlite_schema_version', SQLITE_SCHEMA_VERSION);
    this.setMetadata('graph_store_api_version', GRAPH_STORE_API_VERSION);
    this.setMetadata('graph_store_cache_key_version', GRAPH_STORE_CACHE_KEY_VERSION);
    this.setMetadata('graph_store_derivation_version', GRAPH_STORE_DERIVATION_VERSION);
  }

  private setMetadata(key: string, value: string): void {
    this.db.run(
      `insert into metadata (key, value) values ($key, $value)
       on conflict(key) do update set value = excluded.value`,
      { $key: key, $value: value },
    );
  }

  private selectEntry(cacheKey: string): EntryRow | undefined {
    const statement = this.db.prepare(
      `select cache_key, key_json, value_json, dependencies_json, metadata_json, created_at, updated_at
       from entries where cache_key = $cache_key limit 1`,
    );
    try {
      statement.bind({ $cache_key: cacheKey });
      if (!statement.step()) return undefined;
      return statement.getAsObject() as unknown as EntryRow;
    } finally {
      statement.free();
    }
  }

  private selectEntries(): EntryRow[] {
    const statement = this.db.prepare(
      'select cache_key, key_json, value_json, dependencies_json, metadata_json, created_at, updated_at from entries',
    );
    const rows: EntryRow[] = [];
    try {
      while (statement.step()) {
        rows.push(statement.getAsObject() as unknown as EntryRow);
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  private countEntries(): number {
    const statement = this.db.prepare('select count(*) as count from entries');
    try {
      if (!statement.step()) return 0;
      const row = statement.getAsObject() as unknown as { count: number };
      return row.count;
    } finally {
      statement.free();
    }
  }
}

function rowToEntry<Value>(row: EntryRow): GraphStoreEntry<Value> {
  try {
    return {
      key: JSON.parse(row.key_json) as GraphStoreCacheKey,
      value: JSON.parse(row.value_json) as Value,
      dependencies: (JSON.parse(row.dependencies_json) as GraphStoreEntry<Value>['dependencies']) ?? [],
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (err) {
    throw new Error(`Failed to deserialize graph store entry ${row.cache_key}: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
}

function matchesInvalidation<Value>(
  entry: GraphStoreEntry<Value>,
  match: GraphStoreInvalidation,
): boolean {
  if (match.scope && entry.key.scope !== match.scope) return false;
  if (match.providerId && entry.key.providerId !== match.providerId) return false;
  if (match.sourceId && entry.key.sourceId !== match.sourceId) {
    const dependencyMatch = entry.dependencies?.some(dep => dep.sourceId === match.sourceId) ?? false;
    if (!dependencyMatch) return false;
  }
  if (match.variant && entry.key.variant !== match.variant) return false;
  if (match.contentHash) {
    const hash = formatContentHash(match.contentHash);
    const keyMatch = formatContentHash(entry.key.contentHash) === hash;
    const dependencyMatch = entry.dependencies?.some(dep => formatContentHash(dep.contentHash) === hash) ?? false;
    if (!keyMatch && !dependencyMatch) return false;
  }
  return true;
}
