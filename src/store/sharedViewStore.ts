import { create } from "zustand";

interface SharedViewState {
  /**
   * True while the current tab is showing a `/c/:shareId` read-only viewer
   * (see SharedCanvasPage.tsx). Distinct from `editorModeStore`'s "view"
   * mode: `view` mode alone only blocks direct scene mutation through the
   * canvas (drag/resize/draw — gated by `canEditScene`). It does NOT stop a
   * viewer from opening the AI chat and asking the agent to edit the canvas
   * — tool handlers in `src/lib/tools/` mutate the scene stores directly,
   * below `canEditScene`, so the only real guarantee is removing the way to
   * invoke them in the first place. Consumers (LeftRail, Toolbar) use this
   * flag to hide those entry points while in the shared viewer.
   */
  isSharedView: boolean;
  setSharedView: (v: boolean) => void;
}

export const useSharedViewStore = create<SharedViewState>((set) => ({
  isSharedView: false,
  setSharedView: (v) => set({ isSharedView: v }),
}));
