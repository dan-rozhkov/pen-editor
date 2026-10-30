// The disk-mirror mechanics shared by desktopDocMirror.ts and desktopWorkflowMirror.ts:
// one store of `{ id, rev }` items, mirrored to the desktop shell's disk through its IPC
// bridge and reconciled at startup. localStorage stays the synchronous working copy; disk
// is the durable one. On the web there is no bridge and every function is a no-op.

import type { Persistence, Tombstone } from "@/lib/localStoreKit";

/** What the shell's disk bridge offers for one kind of item. */
export interface DiskBridgeOf<T> {
  list(): Promise<({ deleted?: { id: string; rev: number }[] } & Record<string, unknown>) | { error: string }>;
  save(item: T): Promise<unknown>;
  remove(id: string): Promise<{ ok: true } | { error: string }>;
  onRemoved?(cb: (ids: string[]) => void): () => void;
}

export interface MirrorConfig<T extends { id: string; rev: number }> {
  /** Log prefix, e.g. "desktopDocMirror". */
  name: string;
  /** Singular noun for log lines. */
  noun: string;
  /** Key of the item array in the bridge's `list()` answer. */
  listKey: string;
  getBridge(): DiskBridgeOf<T> | undefined;
  parse(value: unknown): T | null;
  ids(): string[];
  get(id: string): T | null;
  import(item: T): boolean;
  /** Local delete; `persist: false` for a delete the disk already knows. */
  delete(id: string): void;
  upgradeLegacyRev(id: string): boolean;
  setPersistence(sink: Persistence<T> | null): void;
  tombstones: { read(): Record<string, Tombstone>; prune(): number };
}

export interface Mirror {
  /** True when the startup reconcile is over or the mirror was never started on this page. */
  isReady(): boolean;
  /** Resolves after the startup reconcile finished or failed; at once when this page has no mirror. Never rejects. */
  whenReady(): Promise<void>;
  /** Starts the disk mirror once per page. Resolves when the startup reconcile is done; never rejects. */
  start(): Promise<void>;
  /** Test seam: forgets the started mirror and removes its sink. */
  resetForTests(): void;
}

export function createMirror<T extends { id: string; rev: number }>(config: MirrorConfig<T>): Mirror {
  const { name, noun } = config;
  const warn = (what: string, detail: unknown): void => console.warn(`${name}: ${what}`, detail);

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

  // Disk wants rev >= 1. The reconcile upgrades legacy rev-0 bodies first, so a smaller rev
  // here is a bug upstream: skip it instead of lying about the rev.
  function saveToDisk(bridge: DiskBridgeOf<T>, item: T): void {
    if (item.rev >= 1) track("save", () => bridge.save(item));
    else warn(`skipped a ${noun} with rev < 1`, item.id);
  }

  function parseDisk(value: unknown): T | null {
    // The store's parser defaults a missing rev to 0; a disk entry must state one.
    if (!value || typeof value !== "object" || typeof (value as { rev?: unknown }).rev !== "number") return null;
    return config.parse(value);
  }

  async function listDisk(bridge: DiskBridgeOf<T>): Promise<{ items: T[]; deleted: Map<string, number> } | null> {
    let listed: Awaited<ReturnType<DiskBridgeOf<T>["list"]>>;
    try {
      listed = await bridge.list();
    } catch (e) {
      warn("list rejected", e);
      return null;
    }
    const raws = listed && !("error" in listed) ? listed[config.listKey] : undefined;
    if (!listed || "error" in listed || !Array.isArray(raws)) {
      warn("list failed", listed && "error" in listed ? listed.error : listed);
      return null;
    }
    const items: T[] = [];
    for (const raw of raws) {
      const item = parseDisk(raw);
      if (item) items.push(item);
      else warn(`skipped an invalid disk ${noun}`, raw);
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
    return { items, deleted };
  }

  async function reconcile(bridge: DiskBridgeOf<T>): Promise<void> {
    // Bodies from before `rev` existed read as 0; raise them to 1 locally BEFORE any
    // upload, so local and disk agree and the next edit (rev 2) is not stale on disk.
    for (const id of config.ids()) config.upgradeLegacyRev(id);
    config.tombstones.prune();
    const listing = await listDisk(bridge);
    if (!listing) return;
    const { items: disk, deleted } = listing;
    // Deleted on disk (possibly while this panel was offline): drop the local copy unless it is a newer edit.
    // Not persisted (disk has no file) and not uploaded: it is gone from the index before the upload loop.
    for (const [id, rev] of deleted) {
      const local = config.get(id);
      if (local && local.rev <= rev) config.delete(id);
    }
    // Read AFTER the list resolved and the loop above: a delete that landed while the list was
    // in flight (onRemoved) or in that loop leaves a tombstone a stale snapshot would miss.
    const tombstones = config.tombstones.read();
    const diskRev = new Map<string, number>();
    const resurrected: string[] = [];
    for (const item of disk) {
      const tombstone = tombstones[item.id];
      if (tombstone !== undefined && item.rev <= tombstone.rev) {
        resurrected.push(item.id);
        continue;
      }
      // The same id listed and tombstoned (a remove between the store's reads): the delete wins.
      const diskDeleted = deleted.get(item.id);
      if (diskDeleted !== undefined && item.rev <= diskDeleted) continue;
      diskRev.set(item.id, item.rev);
      config.import(item);
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
    // Local-only items (including ones from before the mirror existed) and locally newer ones go to disk.
    for (const id of config.ids()) {
      const local = config.get(id);
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
        if (typeof id === "string" && config.get(id)) config.delete(id);
      } catch (e) {
        warn("removed-by-shell delete threw", e);
      }
    }
  }

  return {
    isReady: () => !started || settled,
    whenReady: () => started ?? Promise.resolve(),
    start() {
      if (started) return started;
      const bridge = config.getBridge();
      if (!bridge) return Promise.resolve();
      config.setPersistence({
        save: (item) => saveToDisk(bridge, item),
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
    },
    resetForTests() {
      started = null;
      settled = false;
      try {
        unsubscribeRemoved?.();
      } catch {
        // Test seam: a failing unsubscribe changes nothing.
      }
      unsubscribeRemoved = null;
      config.setPersistence(null);
    },
  };
}
