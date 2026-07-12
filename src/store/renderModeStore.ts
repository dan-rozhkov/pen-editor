import { create } from "zustand";
import { useLayers3DStore } from "@/store/layers3dStore";

/**
 * Wireframe view (Figma's View → Outline): when `renderMode` is "outline",
 * the canvas draws only node geometry outlines — no fills, images, patterns,
 * shaders, video, shadows, blurs or masks. See `src/pixi/renderers/` for the
 * per-node-type outline drawing and `src/pixi/pixiSync.ts` for the full
 * rebuild triggered on mode change.
 *
 * Mutually exclusive with the 3D layer view (`layers3dStore`): entering one
 * exits the other. The coupling lives on both sides (this store exits 3D view
 * when switching to outline; `layers3dStore.enter` resets this store to
 * "normal") so either entry point stays correct regardless of which UI
 * surface triggers it.
 */
export type RenderMode = "normal" | "outline";

interface RenderModeState {
  renderMode: RenderMode;
  toggle: () => void;
  setRenderMode: (mode: RenderMode) => void;
}

export const useRenderModeStore = create<RenderModeState>((set, get) => ({
  renderMode: "normal",

  toggle: () => {
    const next: RenderMode = get().renderMode === "normal" ? "outline" : "normal";
    get().setRenderMode(next);
  },

  setRenderMode: (mode) => {
    if (mode === "outline" && useLayers3DStore.getState().active) {
      useLayers3DStore.getState().exit();
    }
    set({ renderMode: mode });
  },
}));
