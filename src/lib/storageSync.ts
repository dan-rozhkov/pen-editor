/**
 * Follow a localStorage key written by ANOTHER same-origin document (the
 * Settings tab). `storage` fires only in the other documents, so a store's
 * own write never loops back. Call once at module level; the returned
 * function removes the listener (tests).
 */
export function onStorageKey(key: string, cb: (newValue: string | null) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (e: StorageEvent) => {
    if (e.key !== key || (e.storageArea && e.storageArea !== localStorage)) return;
    cb(e.newValue);
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

export interface StorageFlag {
  get: () => boolean;
  set: (enabled: boolean) => void;
  /** useSyncExternalStore subscribe: fires on a local `set` and on another document's write. */
  subscribe: (cb: () => void) => () => void;
}

/**
 * A boolean kept in one localStorage key, readable through `useSyncExternalStore`. Give exactly one marker:
 * `onValue` (key holds it = on, absent = off) or `offValue` (key holds it = off, absent = on). Storage that
 * throws (private mode/quota) reads as the absent state and the write just doesn't stick.
 */
export function createStorageFlag(key: string, marker: { onValue: string } | { offValue: string }): StorageFlag {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  onStorageKey(key, notify);
  const inverted = "offValue" in marker;
  const value = inverted ? marker.offValue : marker.onValue;
  const fromRaw = (raw: string | null) => (inverted ? raw !== value : raw === value);
  return {
    get() {
      try {
        return fromRaw(localStorage.getItem(key));
      } catch {
        return fromRaw(null);
      }
    },
    set(enabled) {
      try {
        if (enabled === inverted) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        // localStorage unavailable: the switch just doesn't stick.
      }
      notify();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}
