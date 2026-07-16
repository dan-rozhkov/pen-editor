import { create } from "zustand";
import type { ExportSetting } from "@/types/scene";

/**
 * Ephemeral, session-only Export overrides for Dev Mode (dev-03). Dev Mode is
 * read-only (dev-01) — editing export rows there must NOT mutate
 * `node.exportSettings` (part of the `.pen` document). Instead, edits are
 * kept here, keyed by node id, and applied only for display/export while Dev
 * Mode is active. Not persisted to localStorage; cleared entirely when Dev
 * Mode is exited (see `devModeStore.setActive(false)`, mirroring
 * `useMeasureStore.clearLines()`).
 *
 * A node absent from `overrides` has not been touched in Dev Mode — callers
 * should fall back to `node.exportSettings`. A node present here has its
 * whole list replaced by the override (no per-row merge).
 */
interface DevExportState {
  overrides: Record<string, ExportSetting[]>;
  setOverride: (nodeId: string, settings: ExportSetting[]) => void;
  clearAll: () => void;
}

export const useDevExportStore = create<DevExportState>((set) => ({
  overrides: {},

  setOverride: (nodeId, settings) =>
    set((state) => ({ overrides: { ...state.overrides, [nodeId]: settings } })),

  clearAll: () => set({ overrides: {} }),
}));
