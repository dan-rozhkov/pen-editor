// Browser-side canvas store (IndexedDB) with the `DesktopCanvasesApi` shape. Used only for
// pages framed by the workspace shell. Two object stores in one database: `metas` (small
// records, what `list()` reads) and `documents` (the big `.pen` strings).

import type { DesktopCanvasesApi, StoredCanvas, StoredCanvasMeta } from "@/lib/desktopBridge";

const DB_NAME = "pen-canvases";
const DB_VERSION = 1;
const METAS = "metas";
const DOCS = "documents";
const CHANNEL = "pen.canvases";

export interface WebCanvasChange {
  id: string;
  deleted?: true;
  title?: string;
  updatedAt?: number;
}

type Listener = (change: WebCanvasChange) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null | undefined;
let dbPromise: Promise<IDBDatabase> | null = null;
/** The open connection, kept so a save can place its requests in the same tick (see `save`). */
let cachedDb: IDBDatabase | null = null;

export const OTHER_WINDOW_MESSAGE = "This canvas is open in another window.";
const READ_LOCK_WAIT_MS = 1500;
const REMOVE_LOCK_WAIT_MS = 2000;
/** Canvas ids whose Web Lock this page holds until it dies: this page is their only writer. */
const held = new Map<string, () => void>();
const acquiring = new Map<string, Promise<boolean>>();

function locksApi(): LockManager | undefined {
  return typeof navigator !== "undefined" ? navigator.locks : undefined;
}

function lockName(id: string): string {
  return `pen.canvas.${id}`;
}

/**
 * Takes the canvas lock and keeps it (until `releaseWebCanvasLock`, else until the page dies). Resolves false when it is not obtained within `waitMs` (`ifAvailable`:
 * at once). Without the Web Locks API it resolves true and `held` stays empty.
 */
function acquire(id: string, waitMs: number, ifAvailable = false): Promise<boolean> {
  const locks = locksApi();
  if (!locks) return Promise.resolve(true);
  if (held.has(id)) return Promise.resolve(true);
  const pending = acquiring.get(id);
  if (pending) return pending;
  const p = new Promise<boolean>((resolve) => {
    const ctl = new AbortController();
    const timer = ifAvailable ? undefined : setTimeout(() => ctl.abort(), waitMs);
    const options: LockOptions = ifAvailable ? { ifAvailable: true } : { signal: ctl.signal };
    locks
      .request(lockName(id), options, (lock) => {
        clearTimeout(timer);
        if (!lock) {
          resolve(false);
          return undefined;
        }
        const hold = new Promise<void>((release) => held.set(id, release));
        resolve(true);
        return hold;
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(false);
      });
  }).finally(() => {
    acquiring.delete(id);
  });
  acquiring.set(id, p);
  return p;
}

/**
 * Gives back the lock this page holds on `id` (a frame that forked to a new id no longer writes
 * the old one, so the old canvas can be opened or deleted again). No-op when not held.
 */
export function releaseWebCanvasLock(id: string): void {
  const release = held.get(id);
  if (!release) return;
  held.delete(id);
  release();
}

/** Runs `fn` under the canvas lock and releases it after. null = the lock was not obtained in time. */
async function withLock<T>(id: string, waitMs: number, fn: () => Promise<T>): Promise<{ value: T } | null> {
  const locks = locksApi();
  if (!locks || held.has(id)) return { value: await fn() };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), waitMs);
  try {
    return await locks.request(lockName(id), { signal: ctl.signal }, async () => {
      clearTimeout(timer);
      return { value: await fn() };
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Journal: the browser aborts an IndexedDB transaction when the frame dies (reload, close), so a
// save made in `pagehide` never commits. localStorage is synchronous, so a save made while the
// page is unloading is also written there, and the next `read`/`list` merges it back by rev.
// A document over the storage quota is not journaled: it loses only the last autosave window.
const JOURNAL_PREFIX = "pen.canvas.journal.";
let unloading = false;

if (typeof window !== "undefined") {
  // Capture phase: runs before the persistence module's own pagehide listener on the target.
  window.addEventListener("pagehide", () => (unloading = true), { capture: true });
  // A page restored from the back/forward cache is alive again.
  window.addEventListener("pageshow", () => (unloading = false));
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota or blocked storage: the IndexedDB write still runs */
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function journalIds(): string[] {
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(JOURNAL_PREFIX)) ids.push(k.slice(JOURNAL_PREFIX.length));
    }
  } catch {
    /* ignore */
  }
  return ids;
}

/** The parsed journal of `id`; one that does not parse is removed. */
function readJournal(id: string): StoredCanvas | null {
  const raw = lsGet(JOURNAL_PREFIX + id);
  if (raw === null) return null;
  try {
    const j = JSON.parse(raw) as StoredCanvas;
    if (j && typeof j.id === "string" && typeof j.rev === "number" && typeof j.document === "string") return j;
  } catch {
    /* fall through */
  }
  lsRemove(JOURNAL_PREFIX + id);
  return null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(METAS)) db.createObjectStore(METAS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        cachedDb = null;
      };
      db.onclose = () => {
        dbPromise = null;
        cachedDb = null;
      };
      cachedDb = db;
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("open failed"));
    req.onblocked = () => reject(new Error("open blocked"));
  });
  dbPromise = p;
  p.catch(() => {
    if (dbPromise === p) dbPromise = null;
  });
  return p;
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
  } catch {
    channel = null;
  }
  return channel;
}

function emit(change: WebCanvasChange): void {
  for (const l of [...listeners]) {
    try {
      l(change);
    } catch {
      /* a listener never fails a write */
    }
  }
  try {
    getChannel()?.postMessage(change);
  } catch {
    /* best effort */
  }
}

/** Delivers changes made by this page and by other pages of the same origin. */
export function subscribeWebCanvases(listener: Listener): () => void {
  listeners.add(listener);
  const ch = getChannel();
  const onMessage = (e: MessageEvent): void => {
    const d = e.data as WebCanvasChange | null;
    if (d && typeof d.id === "string") {
      try {
        listener(d);
      } catch {
        /* ignore */
      }
    }
  };
  ch?.addEventListener("message", onMessage);
  return () => {
    listeners.delete(listener);
    ch?.removeEventListener("message", onMessage);
  };
}

export const webCanvasStore: Required<DesktopCanvasesApi> = {
  async list() {
    try {
      const db = await openDb();
      const tx = db.transaction(METAS, "readonly");
      const metas = (await reqResult(tx.objectStore(METAS).getAll())) as StoredCanvasMeta[];
      // Overlay journals without writing, so a canvas shows before its frame is opened again.
      const byId = new Map(metas.map((m) => [m.id, m]));
      for (const id of journalIds()) {
        const j = readJournal(id);
        const m = byId.get(id);
        // A journal the store already has (rev <= meta) is dead weight; a newer one is the only copy.
        if (j && m && j.rev <= m.rev) lsRemove(JOURNAL_PREFIX + id);
        if (j && (!m || j.rev > m.rev)) byId.set(id, { id: j.id, title: j.title, updatedAt: j.updatedAt, rev: j.rev });
      }
      return { canvases: [...byId.values()] };
    } catch (e) {
      return { error: errMsg(e) };
    }
  },

  async read(id) {
    try {
      // The single writer of a canvas: a second window gets an error and never saves.
      if (!(await acquire(id, READ_LOCK_WAIT_MS))) return { error: OTHER_WINDOW_MESSAGE };
      const db = await openDb();
      const tx = db.transaction([METAS, DOCS], "readonly");
      const [meta, document] = await Promise.all([
        reqResult(tx.objectStore(METAS).get(id)) as Promise<StoredCanvasMeta | undefined>,
        reqResult(tx.objectStore(DOCS).get(id)) as Promise<string | undefined>,
      ]);
      const journal = readJournal(id);
      if (journal && (!meta || journal.rev > meta.rev)) {
        try {
          const wtx = db.transaction([METAS, DOCS], "readwrite");
          const done = txDone(wtx);
          putCanvas(wtx, journal);
          await done;
          lsRemove(JOURNAL_PREFIX + id);
        } catch {
          /* keep the journal for the next read */
        }
        return { canvas: journal };
      }
      if (journal) lsRemove(JOURNAL_PREFIX + id);
      if (!meta || typeof document !== "string") return { canvas: null };
      const canvas: StoredCanvas = { ...meta, document };
      return { canvas };
    } catch (e) {
      return { error: errMsg(e) };
    }
  },

  async save(canvas) {
    // Before any await: the page may be gone by the next tick.
    if (unloading) lsSet(JOURNAL_PREFIX + canvas.id, JSON.stringify(canvas));
    try {
      if (held.has(canvas.id)) {
        // The only writer: no read first. With the connection open both puts are placed in this
        // tick, because a request placed after an awaited `get` never runs in an unloading page.
        const db = cachedDb ?? (await openDb());
        const tx = db.transaction([METAS, DOCS], "readwrite");
        const done = txDone(tx);
        putCanvas(tx, canvas);
        await done;
        emit({ id: canvas.id, title: canvas.title, updatedAt: canvas.updatedAt });
        return { ok: true as const, rev: canvas.rev };
      }
      // A canvas forked to a new id was never read: take its lock now, if free.
      await acquire(canvas.id, 0, true);
      const db = await openDb();
      const tx = db.transaction([METAS, DOCS], "readwrite");
      const done = txDone(tx);
      const metas = tx.objectStore(METAS);
      const existing = (await reqResult(metas.get(canvas.id))) as StoredCanvasMeta | undefined;
      if (existing && existing.rev >= canvas.rev) {
        tx.abort();
        await done.catch(() => {});
        return { ok: true as const, stale: true as const, rev: existing.rev };
      }
      putCanvas(tx, canvas);
      await done;
      emit({ id: canvas.id, title: canvas.title, updatedAt: canvas.updatedAt });
      return { ok: true as const, rev: canvas.rev };
    } catch (e) {
      return { error: errMsg(e) };
    }
  },

  async remove(id) {
    try {
      const del = async (): Promise<void> => {
        const db = await openDb();
        const tx = db.transaction([METAS, DOCS], "readwrite");
        const done = txDone(tx);
        tx.objectStore(METAS).delete(id);
        tx.objectStore(DOCS).delete(id);
        await done;
        // After the delete, or `list()` would bring the canvas back from the journal.
        lsRemove(JOURNAL_PREFIX + id);
      };
      // Another window may be writing this canvas: delete only once we are its sole holder.
      const res = await withLock(id, REMOVE_LOCK_WAIT_MS, del);
      if (!res) return { error: OTHER_WINDOW_MESSAGE };
      emit({ id, deleted: true });
      return { ok: true as const };
    } catch (e) {
      return { error: errMsg(e) };
    }
  },
};

function putCanvas(tx: IDBTransaction, canvas: StoredCanvas): void {
  const { document, ...meta } = canvas;
  tx.objectStore(METAS).put({ id: meta.id, title: meta.title, updatedAt: meta.updatedAt, rev: meta.rev });
  tx.objectStore(DOCS).put(document, canvas.id);
}

/** Test seam: drop the cached connection and channel. */
export function resetWebCanvasStoreForTests(): void {
  void dbPromise?.then((db) => db.close()).catch(() => {});
  dbPromise = null;
  cachedDb = null;
  for (const release of held.values()) release();
  held.clear();
  acquiring.clear();
  try {
    if (channel) channel.close();
  } catch {
    /* ignore */
  }
  channel = undefined;
  listeners.clear();
  unloading = false;
}
