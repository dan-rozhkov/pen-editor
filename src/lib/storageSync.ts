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
