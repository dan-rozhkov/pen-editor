import { create } from "zustand";
import { toast } from "sonner";
import { getAvailableFonts, notifyFontsChanged } from "@/utils/fontUtils";
import { validateCustomFontFile } from "@/utils/customFontValidation";
import {
  deleteCustomFontRecord,
  getAllCustomFontRecords,
  putCustomFontRecord,
  type CustomFontRecord,
} from "@/utils/customFontDb";
import { registerFontFace, unregisterFontFace } from "@/utils/customFontRegistration";

/**
 * Custom fonts live only in this browser's IndexedDB — uploading a font here
 * does not embed it in the `.pen` document or in HTML/PDF export output.
 * Sharing a `.pen` file or exported HTML does NOT carry uploaded fonts with
 * it; the recipient sees the fallback font unless they upload the same file
 * themselves. Embedding custom fonts in documents/exports is deferred (v2).
 */

/** In-memory/picker-facing view of an uploaded font (no binary — see customFontDb for that). */
export interface CustomFontEntry {
  family: string;
  fileName: string;
  format: CustomFontRecord["format"];
}

interface CustomFontState {
  customFonts: CustomFontEntry[];
  /** True once `restoreCustomFonts()` has run at startup (successfully or not). */
  hydrated: boolean;
  /**
   * Validates, registers with the browser, and persists an uploaded font file.
   * Resolves to the derived family name on success (so the caller can apply
   * it immediately) or `null` on failure (a toast is shown either way).
   */
  addCustomFont: (file: File) => Promise<string | null>;
  removeCustomFont: (family: string) => Promise<void>;
  /** Re-registers every IndexedDB-persisted custom font's FontFace. Call once at startup. */
  restoreCustomFonts: () => Promise<void>;
}

export const useCustomFontStore = create<CustomFontState>((set, get) => ({
  customFonts: [],
  hydrated: false,

  addCustomFont: async (file) => {
    const existingFamilies = get().customFonts.map((f) => f.family);
    // Reserve every family the picker already offers (system/Google/common) so
    // an upload can't register a FontFace that hijacks a built-in font's name.
    const reservedFamilies = (await getAvailableFonts()).map((f) => f.family);
    const validation = validateCustomFontFile(file, existingFamilies, reservedFamilies);
    if (!validation.ok) {
      toast.error(validation.error);
      return null;
    }

    const { family, format } = validation;
    try {
      const bytes = await file.arrayBuffer();
      await registerFontFace(family, bytes);
      try {
        await putCustomFontRecord({ family, fileName: file.name, format, bytes });
      } catch (persistError) {
        // The FontFace is already live in the browser; if we can't persist it,
        // roll it back so the user isn't left with a session-only font that
        // silently disappears on reload and reports success falsely.
        unregisterFontFace(family);
        throw persistError;
      }
      set({ customFonts: [...get().customFonts, { family, fileName: file.name, format }] });
      notifyFontsChanged();
      toast.success(`"${family}" uploaded and ready to use.`);
      return family;
    } catch (error) {
      console.warn("Failed to register custom font:", error);
      toast.error(`Couldn't add "${file.name}" — it may be corrupted, unsupported, or storage is full.`);
      return null;
    }
  },

  removeCustomFont: async (family) => {
    // Delete from storage first: if that fails, keep the font registered and
    // in the list so the UI stays consistent with what's actually persisted
    // (otherwise a "removed" font resurrects on the next reload).
    try {
      await deleteCustomFontRecord(family);
    } catch (error) {
      console.warn("Failed to remove custom font from storage:", error);
      toast.error(`Couldn't remove "${family}" — please try again.`);
      return;
    }
    unregisterFontFace(family);
    set({ customFonts: get().customFonts.filter((f) => f.family !== family) });
    // document.fonts fires no event for a programmatic delete, so tell the text
    // renderer to re-bake nodes that were using this font (mirrors addCustomFont).
    notifyFontsChanged();
  },

  restoreCustomFonts: async () => {
    const records = await getAllCustomFontRecords();

    // Register in parallel so startup waits on the slowest font, not their sum.
    const results = await Promise.allSettled(
      records.map(async (record) => {
        await registerFontFace(record.family, record.bytes);
        return record;
      }),
    );

    const restored: CustomFontEntry[] = [];
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        const record = result.value;
        restored.push({ family: record.family, fileName: record.fileName, format: record.format });
      } else {
        console.warn(`Failed to restore custom font "${records[i]?.family}":`, result.reason);
      }
    });

    set({ customFonts: restored, hydrated: true });
    if (restored.length > 0) {
      notifyFontsChanged();
    }
  },
}));
