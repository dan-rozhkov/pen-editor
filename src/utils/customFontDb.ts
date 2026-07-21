import type { FontFormat } from "./customFontValidation";
import { createIndexedDbStore } from "./indexedDbStore";

/** A persisted custom font — the raw binary lives here, not in the `.pen` document. */
export interface CustomFontRecord {
  family: string;
  fileName: string;
  format: FontFormat;
  bytes: ArrayBuffer;
}

/** Shares its open/read/write/delete shape with `pluginDb.ts` via `indexedDbStore.ts`. */
const store = createIndexedDbStore<CustomFontRecord>({
  dbName: "pen-editor-custom-fonts",
  storeName: "fonts",
  keyPath: "family",
  label: "custom-font",
});

export const getAllCustomFontRecords = store.getAll;
export const putCustomFontRecord = store.put;
export const deleteCustomFontRecord = store.remove;
