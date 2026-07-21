import type { PenPlugin } from "@/lib/plugins/types";

/** IndexedDB persistence for installed plugins — app-level storage, not part
 * of the `.pen` document (doc-scoped plugins are plg-05). Modeled on
 * `customFontDb.ts`. */

const DB_NAME = "pen-editor-plugins";
const DB_VERSION = 1;
const STORE_NAME = "plugins";

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDBAvailable()) {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open the plugin database."));
    }).catch((error) => {
      // Don't cache a rejected open forever — a transient failure would
      // otherwise permanently disable plugin persistence for the session.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Read every stored plugin. Resolves to `[]` (never throws) if IndexedDB is unavailable. */
export async function getAllPlugins(): Promise<PenPlugin[]> {
  if (!isIndexedDBAvailable()) return [];
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as PenPlugin[]);
      request.onerror = () => reject(request.error ?? new Error("Failed to read plugins."));
    });
  } catch (error) {
    console.warn("Failed to read plugins from IndexedDB:", error);
    return [];
  }
}

/** Store (or overwrite, by id) a plugin record. */
export async function putPlugin(plugin: PenPlugin): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(plugin);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to store plugin."));
  });
}

export async function deletePlugin(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to remove plugin."));
  });
}
