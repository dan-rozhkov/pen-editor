/**
 * Generic single-object-store IndexedDB wrapper. Factored out of
 * `customFontDb.ts` and `pluginDb.ts` — both persist a flat list of app-level
 * records (not part of the `.pen` document) keyed by a single field, with the
 * same open/read/write/delete shape and the same graceful-degradation
 * behavior: reads resolve to `[]` (never throw) if IndexedDB is unavailable
 * or the open fails, writes reject.
 */

export interface IndexedDbStoreOptions {
  dbName: string;
  dbVersion?: number;
  storeName: string;
  keyPath: string;
  /** Used only in warning/error messages, e.g. "plugin" → "Failed to open the plugin database." */
  label: string;
}

export interface IndexedDbStore<T> {
  /** Read every stored record. Resolves to `[]` (never throws) if IndexedDB is unavailable. */
  getAll(): Promise<T[]>;
  /** Store (or overwrite, by `keyPath`) a record. */
  put(record: T): Promise<void>;
  remove(key: IDBValidKey): Promise<void>;
}

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export function createIndexedDbStore<T>(options: IndexedDbStoreOptions): IndexedDbStore<T> {
  const { dbName, storeName, keyPath, label } = options;
  const dbVersion = options.dbVersion ?? 1;

  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    if (!isIndexedDBAvailable()) {
      return Promise.reject(new Error("IndexedDB is not available in this environment."));
    }
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error(`Failed to open the ${label} database.`));
      }).catch((error) => {
        // Don't cache a rejected open forever — a transient failure would
        // otherwise permanently disable persistence for the session.
        dbPromise = null;
        throw error;
      });
    }
    return dbPromise;
  }

  async function getAll(): Promise<T[]> {
    try {
      const db = await openDb();
      return await new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () =>
          reject(request.error ?? new Error(`Failed to read ${label} records.`));
      });
    } catch (error) {
      console.warn(`Failed to read ${label} records from IndexedDB:`, error);
      return [];
    }
  }

  async function put(record: T): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Failed to store ${label} record.`));
    });
  }

  async function remove(key: IDBValidKey): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Failed to remove ${label} record.`));
    });
  }

  return { getAll, put, remove };
}
