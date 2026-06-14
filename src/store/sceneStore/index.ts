import { create } from "zustand";
import { registerFontLoadCallback } from "../../utils/fontUtils";
import { resyncAllTextNodeDimensionsInStore } from "./helpers/textSync";
import { getCachedTree } from "./helpers/treeCache";
import { createBasicMutations } from "./basicMutations";
import { createInstanceOperations } from "./instanceOperations";
import { createComponentArtifactOperations } from "./componentArtifacts";
import { createComplexOperations } from "./complexOperations";
import type { SceneState } from "./types";

// Re-export types and utilities
export type { SceneState } from "./types";
export { createSnapshot } from "./helpers/history";

// ----- Store -----

export const useSceneStore = create<SceneState>((set, get) => ({
  nodesById: {},
  parentById: {},
  childrenById: {},
  rootIds: [],
  componentArtifactsById: {},
  _cachedTree: null,
  expandedFrameIds: new Set<string>(),
  pageBackground: "#f5f5f5",

  // Lazy tree builder for backward compat
  getNodes: () => getCachedTree(get()),

  // ----- Basic Mutations (CRUD / tree / visibility / move) -----
  ...createBasicMutations(set, get),

  // ----- Component Instance Operations (ref overrides / slots / detach) -----
  ...createInstanceOperations(set, get),

  // ----- Component Artifact Sync -----
  ...createComponentArtifactOperations(set),

  // ----- Complex Operations (Group/Ungroup/Convert/Wrap) -----
  ...createComplexOperations(get, (partial) => set(partial)),

  // ----- Page Background -----
  setPageBackground: (color) =>
    set(() => {
      return { pageBackground: color };
    }),
}));

// ----- Font Loading Side Effects -----

// Re-sync text dimensions whenever a Google Font finishes loading
registerFontLoadCallback(() => {
  resyncAllTextNodeDimensionsInStore(
    () => useSceneStore.getState(),
    (state) => useSceneStore.setState(state),
  );
});

// Re-sync text dimensions for any font load completion in the document
// (custom local/web fonts loaded outside loadGoogleFont()).
if (typeof document !== "undefined" && "fonts" in document) {
  document.fonts.addEventListener("loadingdone", () => {
    resyncAllTextNodeDimensionsInStore(
      () => useSceneStore.getState(),
      (state) => useSceneStore.setState(state),
    );
  });
}
