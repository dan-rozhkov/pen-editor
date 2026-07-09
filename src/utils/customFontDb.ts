import type { FontFormat } from "./customFontValidation";

/** A persisted custom font — the raw binary lives here, not in the `.pen` document. */
export interface CustomFontRecord {
  family: string;
  fileName: string;
  format: FontFormat;
  bytes: ArrayBuffer;
}

const DB_NAME = "pen-editor-custom-fonts";
const DB_VERSION = 1;
const STORE_NAME = "fonts";

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
          db.createObjectStore(STORE_NAME, { keyPath: "family" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open the custom-font database."));
    }).catch((error) => {
      // Don't cache a rejected open forever — a transient failure would
      // otherwise permanently disable font persistence for the session.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Read every stored custom font. Resolves to `[]` (never throws) if IndexedDB is unavailable. */
export async function getAllCustomFontRecords(): Promise<CustomFontRecord[]> {
  if (!isIndexedDBAvailable()) return [];
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as CustomFontRecord[]);
      request.onerror = () => reject(request.error ?? new Error("Failed to read custom fonts."));
    });
  } catch (error) {
    console.warn("Failed to read custom fonts from IndexedDB:", error);
    return [];
  }
}

/** Store (or overwrite, by family name) a custom font record. */
export async function putCustomFontRecord(record: CustomFontRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to store custom font."));
  });
}

export async function deleteCustomFontRecord(family: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(family);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to remove custom font."));
  });
}
