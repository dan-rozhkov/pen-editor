// Mechanics shared by the localStorage-backed stores (docs/docStore.ts and
// workflows/workflowStore.ts): guarded JSON access, delete tombstones and the
// persistence sink the desktop disk mirror installs. Every localStorage access
// is wrapped: a private window or blocked site data makes getItem/setItem throw.

export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** A tombstone older than this is dropped by the startup reconcile. */
export const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface Tombstone {
  /** The rev the item had when it was deleted. */
  rev: number;
  /** Date.now() at deletion. */
  at: number;
}

export interface TombstoneStore {
  /** Deleted ids as `{ [id]: { rev, at } }`. Keeps a stale disk copy from bringing a deleted item back. */
  read(): Record<string, Tombstone>;
  /** Records a delete at `rev` (keeping a higher rev already stored). */
  record(id: string, rev: number): void;
  clear(id: string): void;
  /** Drops tombstones older than `maxAgeMs`; returns how many went. */
  prune(maxAgeMs?: number): number;
}

/** Tombstones kept in one localStorage key. */
export function createTombstoneStore(key: string): TombstoneStore {
  const read = (): Record<string, Tombstone> => {
    const raw = readJson<Record<string, unknown>>(key);
    const out: Record<string, Tombstone> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [id, value] of Object.entries(raw)) {
        const t = value as Partial<Tombstone> | null;
        if (t && typeof t === "object" && typeof t.rev === "number" && typeof t.at === "number") out[id] = { rev: t.rev, at: t.at };
      }
    }
    return out;
  };
  const write = (map: Record<string, Tombstone>): void => {
    if (Object.keys(map).length === 0) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Storage blocked: nothing was stored either.
      }
      return;
    }
    writeJson(key, map);
  };
  return {
    read,
    record(id, rev) {
      const map = read();
      map[id] = { rev: Math.max(map[id]?.rev ?? 0, rev), at: Date.now() };
      write(map);
    },
    clear(id) {
      const map = read();
      if (!(id in map)) return;
      delete map[id];
      write(map);
    },
    prune(maxAgeMs = TOMBSTONE_MAX_AGE_MS) {
      const map = read();
      const now = Date.now();
      let dropped = 0;
      for (const [id, t] of Object.entries(map)) {
        if (now - t.at > maxAgeMs) {
          delete map[id];
          dropped++;
        }
      }
      if (dropped > 0) write(map);
      return dropped;
    },
  };
}

/** Receives every successful write made by THIS page (never changes from other pages or from an import). */
export interface Persistence<T> {
  save(item: T): void;
  remove(id: string): void;
}

export interface PersistenceSlot<T> {
  set(sink: Persistence<T> | null): void;
  active(): boolean;
  /** Runs `call` on the sink; a sink failure must never turn a finished local write into a failed one. */
  run(call: (sink: Persistence<T>) => void): void;
}

export function createPersistenceSlot<T>(label: string): PersistenceSlot<T> {
  let sink: Persistence<T> | null = null;
  return {
    set: (next) => {
      sink = next;
    },
    active: () => sink !== null,
    run(call) {
      if (!sink) return;
      try {
        call(sink);
      } catch (e) {
        console.error(`${label} persistence failed`, e);
      }
    },
  };
}
