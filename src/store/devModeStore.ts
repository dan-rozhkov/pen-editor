import { create } from "zustand";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useMeasureStore } from "@/store/measureStore";

/**
 * Figma-style Dev Mode (inspect mode): read-only overlay exposing CSS-ish
 * measurements/values for the current selection. `active` is a session-only
 * toggle (never persisted — the editor should always boot in normal edit
 * mode); `units`/`remBase` are user preferences persisted across sessions.
 *
 * Entering dev mode force-exits any active draw tool (inspect and drawing
 * are mutually exclusive interaction states); exiting clears the ephemeral
 * measure-line overlay so stale measurements don't linger back in edit mode.
 */
export type InspectUnits = "px" | "rem";

const UNITS_KEY = "dev-mode-units";
const REM_BASE_KEY = "dev-mode-rem-base";

function getInitialUnits(): InspectUnits {
  const stored = localStorage.getItem(UNITS_KEY);
  return stored === "rem" ? "rem" : "px";
}

function getInitialRemBase(): number {
  const stored = localStorage.getItem(REM_BASE_KEY);
  const parsed = stored ? Number(stored) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
}

interface DevModeState {
  active: boolean;
  units: InspectUnits;
  remBase: number;
  toggle: () => void;
  setActive: (active: boolean) => void;
  setUnits: (units: InspectUnits) => void;
  setRemBase: (base: number) => void;
}

export const useDevModeStore = create<DevModeState>((set, get) => ({
  active: false,
  units: getInitialUnits(),
  remBase: getInitialRemBase(),

  toggle: () => {
    get().setActive(!get().active);
  },

  setActive: (active) => {
    if (active) {
      useDrawModeStore.getState().setActiveTool(null);
    } else {
      useMeasureStore.getState().clearLines();
      // The measure tool only makes sense while dev mode is active — exiting
      // with it still selected must reset to the cursor tool, mirroring the
      // force-exit on entry above (setActiveTool also clears any in-flight
      // pen draft / path-edit mode as a side effect).
      if (useDrawModeStore.getState().activeTool === "measure") {
        useDrawModeStore.getState().setActiveTool(null);
      }
    }
    set({ active });
  },

  setUnits: (units) => {
    set({ units });
    try {
      localStorage.setItem(UNITS_KEY, units);
    } catch {
      // localStorage unavailable (private mode/quota) — in-memory state still applies.
    }
  },

  setRemBase: (base) => {
    set({ remBase: base });
    try {
      localStorage.setItem(REM_BASE_KEY, String(base));
    } catch {
      // localStorage unavailable (private mode/quota) — in-memory state still applies.
    }
  },
}));
