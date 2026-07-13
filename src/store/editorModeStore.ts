import { create } from "zustand";
import { useSceneStore } from "./sceneStore";
import { useSelectionStore } from "./selectionStore";
import { useHoverStore } from "./hoverStore";
import { resolveSlideOrder } from "@/utils/slideOrder";
import { topLevelAncestorId } from "@/utils/topLevelAncestor";
import type { SceneNode } from "@/types/scene";

export type EditorMode = "edit" | "view" | "present";

interface EditorModeState {
  mode: EditorMode;
  presentFrameIds: string[];
  presentIndex: number;
  enterView: () => void;
  enterPresent: () => void;
  exitToEdit: () => void;
  nextFrame: () => void;
  prevFrame: () => void;
}

/** Only the `edit` mode may mutate the scene (move/resize/draw/delete). */
export function canEditScene(mode: EditorMode): boolean {
  return mode === "edit";
}

/** Present locks the canvas entirely; edit and view allow pan/zoom + select. */
export function canInteractCanvas(mode: EditorMode): boolean {
  return mode !== "present";
}

/** Wrap the frame node (from the computed tree) for viewportStore.fitToContent. */
export function presentFitNode(
  nodes: SceneNode[],
  frameId: string | undefined,
): SceneNode[] {
  if (!frameId) return [];
  const node = nodes.find((n) => n.id === frameId);
  return node ? [node] : [];
}

export const useEditorModeStore = create<EditorModeState>((set) => ({
  mode: "edit",
  presentFrameIds: [],
  presentIndex: 0,

  enterView: () => {
    useSelectionStore.getState().clearSelection();
    useHoverStore.getState().clearHovered();
    set({ mode: "view" });
  },

  enterPresent: () => {
    const scene = useSceneStore.getState();
    // Present order follows the user-defined slideOrder (same source of
    // truth as SlidesPanel) rather than a spatial y/x sort, so the panel and
    // Present mode always agree on the sequence.
    const ids = resolveSlideOrder(scene.nodesById, scene.rootIds, scene.slideOrder);
    if (ids.length === 0) return; // nothing to present
    const selected = useSelectionStore.getState().selectedIds[0];
    let index = 0;
    if (selected) {
      const top = topLevelAncestorId(scene.parentById, selected);
      const found = ids.indexOf(top);
      if (found >= 0) index = found;
    }
    // Present is read-only fullscreen — drop the selection so no outline /
    // handles / embed frame render over the presented design (mirrors enterView).
    useSelectionStore.getState().clearSelection();
    useHoverStore.getState().clearHovered();
    set({ mode: "present", presentFrameIds: ids, presentIndex: index });
  },

  exitToEdit: () => set({ mode: "edit", presentFrameIds: [], presentIndex: 0 }),

  nextFrame: () =>
    set((s) => ({
      presentIndex: Math.min(s.presentIndex + 1, s.presentFrameIds.length - 1),
    })),

  prevFrame: () => set((s) => ({ presentIndex: Math.max(s.presentIndex - 1, 0) })),
}));
