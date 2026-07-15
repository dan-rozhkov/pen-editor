import { create } from "zustand";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useMeasureStore } from "@/store/measureStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
// NOTE: this is the one place a store reaches into `pixi/interaction` (every
// other store is a leaf; interaction controllers depend on stores, not vice
// versa). Safe here only because `cancelActiveMeasure` is a plain function
// reference resolved lazily inside `setActive`, never touched at either
// module's top level — so the ES-module circular import (measureToolController
// also imports this store) never observes a not-yet-initialized binding.
import { cancelActiveMeasure } from "@/pixi/interaction/measureToolController";

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
export type CodegenFormat = "css" | "tailwind" | "react";
export type CodegenReactStyle = "inline" | "tailwind";

const UNITS_KEY = "dev-mode-units";
const REM_BASE_KEY = "dev-mode-rem-base";
const CODEGEN_FORMAT_KEY = "dev-mode-codegen-format";
const CODEGEN_REACT_STYLE_KEY = "dev-mode-codegen-react-style";

function getInitialUnits(): InspectUnits {
  const stored = localStorage.getItem(UNITS_KEY);
  return stored === "rem" ? "rem" : "px";
}

function getInitialRemBase(): number {
  const stored = localStorage.getItem(REM_BASE_KEY);
  const parsed = stored ? Number(stored) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
}

function getInitialCodegenFormat(): CodegenFormat {
  const stored = localStorage.getItem(CODEGEN_FORMAT_KEY);
  return stored === "tailwind" || stored === "react" ? stored : "css";
}

function getInitialCodegenReactStyle(): CodegenReactStyle {
  const stored = localStorage.getItem(CODEGEN_REACT_STYLE_KEY);
  return stored === "tailwind" ? "tailwind" : "inline";
}

interface DevModeState {
  active: boolean;
  units: InspectUnits;
  remBase: number;
  codegenFormat: CodegenFormat;
  codegenReactStyle: CodegenReactStyle;
  toggle: () => void;
  setActive: (active: boolean) => void;
  setUnits: (units: InspectUnits) => void;
  setRemBase: (base: number) => void;
  setCodegenFormat: (format: CodegenFormat) => void;
  setCodegenReactStyle: (style: CodegenReactStyle) => void;
}

export const useDevModeStore = create<DevModeState>((set, get) => ({
  active: false,
  units: getInitialUnits(),
  remBase: getInitialRemBase(),
  codegenFormat: getInitialCodegenFormat(),
  codegenReactStyle: getInitialCodegenReactStyle(),

  toggle: () => {
    get().setActive(!get().active);
  },

  setActive: (active) => {
    if (active) {
      useDrawModeStore.getState().setActiveTool(null);
    } else {
      // Abort any in-progress measure drag first — otherwise a stray
      // pointermove/pointerup right after exiting dev mode could still draw
      // the ghost preview or pin a measurement (the gesture lives in the
      // controller's closure, unreachable except via this escape hatch).
      cancelActiveMeasure();
      useMeasureStore.getState().clearLines();
      // The measure tool only makes sense while dev mode is active — exiting
      // with it still selected must reset to the cursor tool, mirroring the
      // force-exit on entry above (setActiveTool also clears any in-flight
      // pen draft / path-edit mode as a side effect).
      if (useDrawModeStore.getState().activeTool === "measure") {
        useDrawModeStore.getState().setActiveTool(null);
      }
      // A pinned measurement's selection highlight is dev-mode-only UI —
      // don't leave it dangling (stale) once dev mode is exited.
      useMeasurementsStore.getState().setSelectedMeasurement(null);
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

  setCodegenFormat: (format) => {
    set({ codegenFormat: format });
    try {
      localStorage.setItem(CODEGEN_FORMAT_KEY, format);
    } catch {
      // localStorage unavailable (private mode/quota) — in-memory state still applies.
    }
  },

  setCodegenReactStyle: (style) => {
    set({ codegenReactStyle: style });
    try {
      localStorage.setItem(CODEGEN_REACT_STYLE_KEY, style);
    } catch {
      // localStorage unavailable (private mode/quota) — in-memory state still applies.
    }
  },
}));
