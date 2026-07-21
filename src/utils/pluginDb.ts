import type { PenPlugin } from "@/lib/plugins/types";
import { createIndexedDbStore } from "@/utils/indexedDbStore";

/** IndexedDB persistence for installed plugins — app-level storage, not part
 * of the `.pen` document (doc-scoped plugins are plg-05). Shares its
 * open/read/write/delete shape with `customFontDb.ts` via
 * `indexedDbStore.ts`. */
const store = createIndexedDbStore<PenPlugin>({
  dbName: "pen-editor-plugins",
  storeName: "plugins",
  keyPath: "id",
  label: "plugin",
});

export const getAllPlugins = store.getAll;
export const putPlugin = store.put;
export const deletePlugin = store.remove;
