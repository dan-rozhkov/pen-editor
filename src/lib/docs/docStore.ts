// Markdown documents: the store behind the /doc surface and the agent's doc_*
// tools. Documents live in this browser's localStorage only — the agent panel
// (/agent) and a desktop doc tab (/doc) share one origin and one storage
// partition, so the panel's tools write here and the tab picks the change up
// through BroadcastChannel. No IPC.
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

function parseDoc(value: unknown): Doc | null {
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

export function createDoc(input: { title: string; markdown?: string }, source: DocChangeSource): Doc {
  const doc: Doc = { id: newDocId(), title: input.title.trim() || "Untitled", markdown: input.markdown ?? "", updatedAt: Date.now(), rev: 1 };
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
  if (patch.title !== undefined) next.title = patch.title.trim() || "Untitled";
  commitDoc(next, source);
  return next;
}

export function deleteDoc(id: string, source: DocChangeSource): void {
  try {
    localStorage.removeItem(DOC_KEY_PREFIX + id);
  } catch {
    // Storage blocked: nothing was stored either.
  }
  writeJson(INDEX_KEY, readIndex().filter((meta) => meta.id !== id));
  notify({ id, deleted: true, source });
}

/**
 * Removes an index entry whose body is gone. Never touches a body: when one
 * exists (even an unreadable one) nothing happens and false is returned.
 */
export function dropStaleIndexEntry(id: string): boolean {
  if (readDoc(id).kind !== "missing") return false;
  writeJson(INDEX_KEY, readIndex().filter((meta) => meta.id !== id));
  notify({ id, deleted: true, source: "editor" });
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
