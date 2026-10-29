// Desktop shell only: mirrors the markdown documents (docStore, localStorage) to
// disk through the shell's IPC bridge and reconciles both copies at startup.
// localStorage stays the synchronous working copy; disk is the durable one.
// On the web there is no bridge and every function here is a no-op.

import type { DesktopDocsDiskApi, StoredDoc } from "@/lib/desktopBridge";
import { deleteDoc, getDoc, importDoc, listDocs, parseDoc, pruneTombstones, readTombstones, setDocPersistence, upgradeLegacyRev, type Doc } from "@/lib/docs/docStore";

type DiskBridge = Required<DesktopDocsDiskApi>;

function isComplete(docs: DesktopDocsDiskApi | undefined): docs is DiskBridge {
  return !!docs && typeof docs.list === "function" && typeof docs.save === "function" && typeof docs.remove === "function";
}

/** The shell's disk store: the agent panel's first, then the desktop tab's. Undefined on the web or on an older shell. */
export function getDesktopDocsBridge(): DiskBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const panel = window.penAgentPanel?.docs;
  if (isComplete(panel)) return panel;
  const tab = window.penDesktop?.docs;
  return isComplete(tab) ? tab : undefined;
}

function warn(what: string, detail: unknown): void {
  console.warn(`desktopDocMirror: ${what}`, detail);
}

// Fire and forget: a failing disk must never touch the local write.
function track(what: string, call: () => Promise<unknown>): void {
  try {
    call().then(
      (result) => {
        if (result && typeof result === "object" && "error" in result) warn(`${what} failed`, (result as { error: unknown }).error);
      },
      (e: unknown) => warn(`${what} rejected`, e),
    );
  } catch (e) {
    warn(`${what} threw`, e);
  }
}

// Disk wants rev >= 1. The reconcile upgrades legacy rev-0 bodies first, so a
// smaller rev here is a bug upstream: skip it instead of lying about the rev.
function forDisk(doc: Doc): StoredDoc | null {
  if (doc.rev >= 1) return doc;
  warn("skipped a document with rev < 1", doc.id);
  return null;
}

function saveToDisk(bridge: DiskBridge, doc: Doc): void {
  const body = forDisk(doc);
  if (body) track("save", () => bridge.save(body));
}

function parseDisk(value: unknown): Doc | null {
  // docStore's parser defaults a missing rev to 0; a disk entry must state one.
  if (!value || typeof value !== "object" || typeof (value as { rev?: unknown }).rev !== "number") return null;
  return parseDoc(value);
}

interface DiskListing {
  docs: Doc[];
  deleted: Map<string, number>;
}

async function listDisk(bridge: DiskBridge): Promise<DiskListing | null> {
  let listed: Awaited<ReturnType<DiskBridge["list"]>>;
  try {
    listed = await bridge.list();
  } catch (e) {
    warn("list rejected", e);
    return null;
  }
  if (!listed || "error" in listed || !Array.isArray(listed.docs)) {
    warn("list failed", listed && "error" in listed ? listed.error : listed);
    return null;
  }
  const docs: Doc[] = [];
  for (const raw of listed.docs) {
    const doc = parseDisk(raw);
    if (doc) docs.push(doc);
    else warn("skipped an invalid disk document", raw);
  }
  // Disk-side tombstones; a malformed entry is ignored, not trusted.
  const deleted = new Map<string, number>();
  if (Array.isArray(listed.deleted)) {
    for (const entry of listed.deleted as unknown[]) {
      const { id, rev } = (entry && typeof entry === "object" ? entry : {}) as { id?: unknown; rev?: unknown };
      if (typeof id === "string" && typeof rev === "number" && Number.isFinite(rev)) deleted.set(id, Math.max(deleted.get(id) ?? 0, rev));
      else warn("skipped an invalid disk tombstone", entry);
    }
  }
  return { docs, deleted };
}

async function reconcile(bridge: DiskBridge): Promise<void> {
  // Bodies from before `rev` existed read as 0; raise them to 1 locally BEFORE any
  // upload, so local and disk agree and the next edit (rev 2) is not stale on disk.
  for (const meta of listDocs()) upgradeLegacyRev(meta.id);
  pruneTombstones();
  const listing = await listDisk(bridge);
  if (!listing) return;
  const { docs: disk, deleted } = listing;
  // Deleted on disk (possibly while this panel was offline): drop the local copy unless it is a newer edit.
  // Not persisted (disk has no file) and not uploaded: it is gone from the index before the upload loop.
  for (const [id, rev] of deleted) {
    const local = getDoc(id);
    if (local && local.rev <= rev) deleteDoc(id, "editor", { persist: false });
  }
  // Read AFTER the list resolved and the loop above: a delete that landed while the list was
  // in flight (onRemoved) or in that loop leaves a tombstone a stale snapshot would miss.
  const tombstones = readTombstones();
  const diskRev = new Map<string, number>();
  const resurrected: string[] = [];
  for (const doc of disk) {
    const tombstone = tombstones[doc.id];
    if (tombstone !== undefined && doc.rev <= tombstone.rev) {
      resurrected.push(doc.id);
      continue;
    }
    // The same id in `docs` and `deleted` (a remove between the store's reads): the delete wins.
    const diskDeleted = deleted.get(doc.id);
    if (diskDeleted !== undefined && doc.rev <= diskDeleted) continue;
    diskRev.set(doc.id, doc.rev);
    importDoc(doc);
  }
  // Deleted here but still on disk (a failed remove): try again. The tombstone stays
  // (a late save may re-create the file) until it ages out or a higher rev wins.
  for (const id of resurrected) {
    try {
      const result = await bridge.remove(id);
      if (result && "error" in result) warn("remove failed", result.error);
    } catch (e) {
      warn("remove rejected", e);
    }
  }
  // Local-only documents (including ones from before the mirror existed) and locally newer ones go to disk.
  for (const meta of listDocs()) {
    const local = getDoc(meta.id);
    if (!local) continue;
    const onDisk = diskRev.get(local.id);
    if (onDisk === undefined || local.rev > onDisk) saveToDisk(bridge, local);
  }
}

let started: Promise<void> | null = null;
let settled = false;
let unsubscribeRemoved: (() => void) | null = null;

// The shell deleted these files itself: drop the local copies (tombstone included), or the
// reconcile would upload them again. Not persisted: the file is already gone on disk.
function applyRemoved(ids: unknown): void {
  if (!Array.isArray(ids)) return;
  for (const id of ids) {
    try {
      if (typeof id === "string" && getDoc(id)) deleteDoc(id, "editor", { persist: false });
    } catch (e) {
      warn("removed-by-shell delete threw", e);
    }
  }
}

/** True when the startup reconcile is over or the mirror was never started on this page. */
export function isDesktopDocsReady(): boolean {
  return !started || settled;
}

/** Resolves after the startup reconcile finished or failed; at once when this page has no mirror. Never rejects. */
export function whenDesktopDocsReady(): Promise<void> {
  return started ?? Promise.resolve();
}

/** Starts the disk mirror once per page. Resolves when the startup reconcile is done; never rejects. */
export function startDesktopDocMirror(): Promise<void> {
  if (started) return started;
  const bridge = getDesktopDocsBridge();
  if (!bridge) return Promise.resolve();
  setDocPersistence({
    save: (doc) => saveToDisk(bridge, doc),
    remove: (id) => track("remove", () => bridge.remove(id)),
  });
  try {
    const off = bridge.onRemoved?.(applyRemoved);
    if (typeof off === "function") unsubscribeRemoved = off;
  } catch (e) {
    warn("onRemoved threw", e);
  }
  started = reconcile(bridge)
    .catch((e: unknown) => warn("reconcile failed", e))
    .finally(() => {
      settled = true;
    });
  return started;
}

/** Test seam: forgets the started mirror and removes its sink. */
export function resetDesktopDocMirrorForTests(): void {
  started = null;
  settled = false;
  try {
    unsubscribeRemoved?.();
  } catch {
    // Test seam: a failing unsubscribe changes nothing.
  }
  unsubscribeRemoved = null;
  setDocPersistence(null);
}
