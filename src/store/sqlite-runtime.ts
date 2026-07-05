import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';

export interface SqliteByteStore {
  load(): Promise<Uint8Array | undefined>;
  save(bytes: Uint8Array): Promise<void>;
}

const DB_NAME = 'kbexplorer-graph-store';
const STORE_NAME = 'sqlite';
const DB_KEY = 'graph-store.sqlite';

const sqlModuleCache = new Map<unknown, Promise<SqlJsStatic>>();

export async function loadSqlJs(locateFile?: (file: string) => string): Promise<SqlJsStatic> {
  const cacheKey = locateFile ?? 'default';
  const cached = sqlModuleCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    if (locateFile) {
      return initSqlJs({ locateFile });
    }

    if (typeof process !== 'undefined' && process.versions?.node) {
      const { nodeLocateFile } = await import('./node-wasm');
      return initSqlJs({ locateFile: nodeLocateFile() });
    }

    return initSqlJs();
  })();

  sqlModuleCache.set(cacheKey, promise);
  return promise;
}

export async function openPersistedDatabase(
  byteStore: SqliteByteStore = new IndexedDbSqliteByteStore(),
  locateFile?: (file: string) => string,
): Promise<{ db: Database; persist: () => Promise<void> }> {
  const SQL = await loadSqlJs(locateFile);
  const bytes = await byteStore.load();
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  return {
    db,
    persist: async () => {
      await byteStore.save(db.export());
    },
  };
}

export class MemorySqliteByteStore implements SqliteByteStore {
  private bytes?: Uint8Array;

  async load(): Promise<Uint8Array | undefined> {
    return this.bytes ? new Uint8Array(this.bytes) : undefined;
  }

  async save(bytes: Uint8Array): Promise<void> {
    this.bytes = new Uint8Array(bytes);
  }
}

export class IndexedDbSqliteByteStore implements SqliteByteStore {
  async load(): Promise<Uint8Array | undefined> {
    const db = await openIndexedDb();
    return requestToPromise<Uint8Array | undefined>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(DB_KEY),
    ).finally(() => db.close());
  }

  async save(bytes: Uint8Array): Promise<void> {
    const db = await openIndexedDb();
    await requestToPromise(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(bytes, DB_KEY),
    ).finally(() => db.close());
  }
}

function openIndexedDb(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    throw new Error('Graph store SQLite persistence requires IndexedDB support.');
  }

  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open graph store IndexedDB database.'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB graph store request failed.'));
  });
}
