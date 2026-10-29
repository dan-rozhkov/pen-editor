// Markdown documents: the store behind the /doc surface and the agent's doc_*
// tools. localStorage is the synchronous working copy — the agent panel (/agent)
// and a desktop doc tab (/doc) share one origin and one storage partition, so the
// panel's tools write here and the tab picks the change up through
// BroadcastChannel. In the desktop shell, desktopDocMirror.ts installs a
// persistence sink (`setDocPersistence`) that mirrors every local write to disk,
// and feeds disk documents back in through `importDoc` at startup. Without a sink
// (the web) nothing leaves this browser.
//
// Every localStorage access is wrapped: a private window or blocked site data
// makes getItem/setItem throw (see opencodeKey.ts for the same rule).

export interface DocMeta {
  id: string;
  title: string;
  updatedAt: number;
}

export interface Doc extends DocMeta {
  markdown: string;
  /**
   * Monotonic write counter: create = 1, +1 on every successful write. Every sync
   * decision compares revs; `updatedAt` is display and sorting only. A body stored
   * without `rev` reads as 0.
   */
  rev: number;
}

/** Who wrote a change: the editor UI or the agent's tools. */
export type DocChangeSource = "editor" | "agent";

export interface DocChange {
  /** The changed document, or the deleted id with `deleted: true`. */
  id: string;
  deleted?: boolean;
  /** Absent for changes that arrive through the `storage` event, which carries no label. */
  source?: DocChangeSource;
  /**
   * The document as written (absent for deletes). Rides along in the message so a
   * receiver need not read localStorage, whose cache may not have the write yet.
   */
  doc?: Doc;
}

const INDEX_KEY = "pen.docs.index";
const DOC_KEY_PREFIX = "pen.docs.doc.";
const CHANNEL_NAME = "pen.docs";

type Listener = (change: DocChange) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readIndex(): DocMeta[] {
  const index = readJson<DocMeta[]>(INDEX_KEY);
  return Array.isArray(index) ? index : [];
}

/** Thrown by writes when localStorage is full or blocked. */
export const DOC_STORAGE_ERROR = "Document storage is unavailable in this browser (localStorage blocked or full).";

/** Receives every successful write made by THIS page (never changes that arrive from other pages or from `importDoc`). */
export interface DocPersistence {
  save(doc: Doc): void;
  remove(id: string): void;
}

let persistence: DocPersistence | null = null;

/** Installs (or with null removes) the sink that mirrors local writes elsewhere, e.g. to disk. */
export function setDocPersistence(sink: DocPersistence | null): void {
  persistence = sink;
}

// A sink failure must never turn a finished local write into a failed one.
function persist(call: (sink: DocPersistence) => void): void {
  if (!persistence) return;
  try {
    call(persistence);
  } catch (e) {
    console.error("docStore persistence failed", e);
  }
}

function newDocId(): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `doc_${uuid.replace(/-/g, "").slice(0, 12)}`;
}

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<DocChange>) => emitLocal(event.data);
  return channel;
}

export function parseDoc(value: unknown): Doc | null {
  const doc = value as Partial<Doc> | null;
  if (!doc || typeof doc.id !== "string" || typeof doc.title !== "string" || typeof doc.markdown !== "string" || typeof doc.updatedAt !== "number") {
    return null;
  }
  return { id: doc.id, title: doc.title, markdown: doc.markdown, updatedAt: doc.updatedAt, rev: typeof doc.rev === "number" ? doc.rev : 0 };
}

function parseDocJson(raw: string): Doc | null {
  try {
    return parseDoc(JSON.parse(raw));
  } catch {
    return null;
  }
}

export type ReadDocResult = { kind: "ok"; doc: Doc } | { kind: "missing" } | { kind: "unreadable" };

/** Tells a body that is not there from one that is there but cannot be parsed or read. */
export function readDoc(id: string): ReadDocResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(DOC_KEY_PREFIX + id);
  } catch {
    return { kind: "unreadable" };
  }
  if (raw === null) return { kind: "missing" };
  const doc = parseDocJson(raw);
  return doc ? { kind: "ok", doc } : { kind: "unreadable" };
}

// Backup signal: a localStorage write in another page. It names no source; listeners
// order changes by rev, not by who wrote them.
let storageListening = false;
function onStorage(event: StorageEvent): void {
  if (!event.key?.startsWith(DOC_KEY_PREFIX)) return;
  const id = event.key.slice(DOC_KEY_PREFIX.length);
  if (event.newValue === null) {
    emitLocal({ id, deleted: true });
    return;
  }
  const doc = parseDocJson(event.newValue);
  if (doc) {
    emitLocal({ id, doc });
    return;
  }
  const read = readDoc(id);
  if (read.kind === "ok") emitLocal({ id, doc: read.doc });
}
function listenToStorage(): void {
  if (storageListening || typeof window === "undefined") return;
  storageListening = true;
  window.addEventListener("storage", onStorage);
}

// One listener throwing must neither skip the others nor make a finished write look failed.
function emitLocal(change: DocChange): void {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch (e) {
      console.error("docStore listener failed", e);
    }
  }
}

function notify(change: DocChange): void {
  emitLocal(change);
  try {
    getChannel()?.postMessage(change);
  } catch (e) {
    console.error("docStore broadcast failed", e);
  }
}

/** Newest first. */
export function listDocs(): DocMeta[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getDoc(id: string): Doc | null {
  const read = readDoc(id);
  return read.kind === "ok" ? read.doc : null;
}

/** The title of a document nobody named. */
export const DEFAULT_DOC_TITLE = "Untitled";

export function createDoc(input: { title: string; markdown?: string }, source: DocChangeSource): Doc {
  const doc: Doc = { id: newDocId(), title: input.title.trim() || DEFAULT_DOC_TITLE, markdown: input.markdown ?? "", updatedAt: Date.now(), rev: 1 };
  commitDoc(doc, source);
  return doc;
}

export interface UpdateDocOptions {
  /** Compare-and-set: write only when the stored rev equals this; otherwise nothing is written and "conflict" is returned. */
  expectedRev?: number;
}

/**
 * Writes the patch over the stored document and returns it (rev + 1). Returns null
 * when no readable document has this id (see `readDoc` for the reason), and
 * "conflict" only when `expectedRev` was passed and differs from the stored rev.
 */
export function updateDoc(id: string, patch: Partial<Pick<Doc, "title" | "markdown">>, source: DocChangeSource): Doc | null;
export function updateDoc(
  id: string,
  patch: Partial<Pick<Doc, "title" | "markdown">>,
  source: DocChangeSource,
  options: UpdateDocOptions,
): Doc | null | "conflict";
export function updateDoc(
  id: string,
  patch: Partial<Pick<Doc, "title" | "markdown">>,
  source: DocChangeSource,
  options?: UpdateDocOptions,
): Doc | null | "conflict" {
  const current = getDoc(id);
  if (!current) return null;
  if (options?.expectedRev !== undefined && current.rev !== options.expectedRev) return "conflict";
  const next: Doc = { ...current, ...patch, updatedAt: Date.now(), rev: current.rev + 1 };
  if (patch.title !== undefined) next.title = patch.title.trim() || DEFAULT_DOC_TITLE;
  commitDoc(next, source);
  return next;
}

const TOMBSTONE_KEY = "pen.docs.deleted";
/** A tombstone older than this is dropped by the startup reconcile. */
export const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface Tombstone {
  /** The rev the document had when it was deleted. */
  rev: number;
  /** Date.now() at deletion. */
  at: number;
}

/** Deleted ids as `{ [id]: { rev, at } }`. Keeps a stale disk copy from bringing a deleted document back. The old numeric format is ignored. */
export function readTombstones(): Record<string, Tombstone> {
  const raw = readJson<Record<string, unknown>>(TOMBSTONE_KEY);
  const out: Record<string, Tombstone> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw)) {
      const t = value as Partial<Tombstone> | null;
      if (t && typeof t === "object" && typeof t.rev === "number" && typeof t.at === "number") out[id] = { rev: t.rev, at: t.at };
    }
  }
  return out;
}

function writeTombstones(map: Record<string, Tombstone>): void {
  if (Object.keys(map).length === 0) {
    try {
      localStorage.removeItem(TOMBSTONE_KEY);
    } catch {
      // Storage blocked: nothing was stored either.
    }
    return;
  }
  writeJson(TOMBSTONE_KEY, map);
}

export function clearTombstone(id: string): void {
  const map = readTombstones();
  if (!(id in map)) return;
  delete map[id];
  writeTombstones(map);
}

/** Drops tombstones older than `maxAgeMs`; returns how many went. */
export function pruneTombstones(maxAgeMs: number = TOMBSTONE_MAX_AGE_MS): number {
  const map = readTombstones();
  const now = Date.now();
  let dropped = 0;
  for (const [id, t] of Object.entries(map)) {
    if (now - t.at > maxAgeMs) {
      delete map[id];
      dropped++;
    }
  }
  if (dropped > 0) writeTombstones(map);
  return dropped;
}

/**
 * `persist: false` is for a delete the disk already knows about (the shell removed the file
 * itself): the tombstone, body, index entry and listeners behave the same, only the sink's remove is skipped.
 */
export function deleteDoc(id: string, source: DocChangeSource, options: { persist?: boolean } = {}): void {
  // Only where a persistence sink exists: a web page has no second copy to guard against.
  const before = persistence ? readDoc(id) : null;
  if (before?.kind === "ok") {
    const map = readTombstones();
    map[id] = { rev: Math.max(map[id]?.rev ?? 0, before.doc.rev), at: Date.now() };
    writeTombstones(map);
  }
  try {
    localStorage.removeItem(DOC_KEY_PREFIX + id);
  } catch {
    // Storage blocked: nothing was stored either.
  }
  writeJson(INDEX_KEY, readIndex().filter((meta) => meta.id !== id));
  notify({ id, deleted: true, source });
  if (options.persist !== false) persist((sink) => sink.remove(id));
}

/**
 * Removes an index entry whose body is gone. Never touches a body: when one
 * exists (even an unreadable one) nothing happens and false is returned.
 */
export function dropStaleIndexEntry(id: string): boolean {
  if (readDoc(id).kind !== "missing") return false;
  writeJson(INDEX_KEY, readIndex().filter((meta) => meta.id !== id));
  notify({ id, deleted: true, source: "editor" });
  // No persistence call: the entry alone is stale, and a disk copy may be the only one left.
  return true;
}

/**
 * Body first, then index; if the index write fails the body goes back to what it
 * was (or disappears on create) so no half-written state stays. Listeners hear
 * about the write only after both succeeded.
 */
function commitDoc(doc: Doc, source: DocChangeSource): void {
  const key = DOC_KEY_PREFIX + doc.id;
  let previous: string | null;
  try {
    previous = localStorage.getItem(key);
  } catch {
    throw new Error(DOC_STORAGE_ERROR);
  }
  if (!writeJson(key, doc)) throw new Error(DOC_STORAGE_ERROR);
  const meta: DocMeta = { id: doc.id, title: doc.title, updatedAt: doc.updatedAt };
  if (!writeJson(INDEX_KEY, [meta, ...readIndex().filter((m) => m.id !== doc.id)])) {
    try {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    } catch {
      // Storage is blocked: the body write above could not have stuck either.
    }
    throw new Error(DOC_STORAGE_ERROR);
  }
  notify({ id: doc.id, source, doc });
  persist((sink) => sink.save(doc));
}

/**
 * Writes a document that came from outside (the desktop disk store), keeping its
 * `rev` and `updatedAt`. Only when the local body is missing, unreadable or has a
 * lower rev, and the id carries no delete tombstone of the same or a higher rev; returns whether it wrote. Never calls the persistence sink (the
 * document already lives there). Listeners hear it with no `source`.
 */
export function importDoc(doc: Doc): boolean {
  const tombstone = readTombstones()[doc.id];
  if (tombstone !== undefined) {
    // A copy at or below the deleted rev is the deleted document coming back; a newer one was written later elsewhere and wins.
    if (doc.rev <= tombstone.rev) return false;
    clearTombstone(doc.id);
  }
  const key = DOC_KEY_PREFIX + doc.id;
  const local = readDoc(doc.id);
  if (local.kind === "ok" && local.doc.rev >= doc.rev) return false;
  let previous: string | null;
  try {
    previous = localStorage.getItem(key);
  } catch {
    return false;
  }
  if (!writeJson(key, doc)) return false;
  const meta: DocMeta = { id: doc.id, title: doc.title, updatedAt: doc.updatedAt };
  if (!writeJson(INDEX_KEY, [meta, ...readIndex().filter((m) => m.id !== doc.id)])) {
    try {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    } catch {
      // Storage is blocked: the body write above could not have stuck either.
    }
    return false;
  }
  notify({ id: doc.id, doc });
  return true;
}

/**
 * Adds the index entry of a document whose body exists but whose index entry is
 * missing (an interrupted write, a stale index), and announces it so open
 * pages refresh their list.
 */
export function repairDocIndex(id: string): boolean {
  const doc = getDoc(id);
  if (!doc) return false;
  const index = readIndex();
  if (index.some((m) => m.id === id)) return true;
  if (!writeJson(INDEX_KEY, [{ id: doc.id, title: doc.title, updatedAt: doc.updatedAt }, ...index])) return false;
  notify({ id: doc.id, source: "editor", doc });
  return true;
}

/** Subscribes to changes from this page and from other same-origin pages. Returns the unsubscribe function. */
export function subscribeDocs(listener: Listener): () => void {
  listeners.add(listener);
  getChannel();
  listenToStorage();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Raises a local body stored without a `rev` (reads as 0) to rev 1, keeping title,
 * markdown and updatedAt. Never calls the persistence sink. Listeners hear it with
 * no `source`, so an open editor adopts the rev. Returns whether it wrote.
 */
export function upgradeLegacyRev(id: string): boolean {
  const read = readDoc(id);
  if (read.kind !== "ok" || read.doc.rev >= 1) return false;
  const next: Doc = { ...read.doc, rev: 1 };
  if (!writeJson(DOC_KEY_PREFIX + id, next)) return false;
  notify({ id, doc: next });
  return true;
}
