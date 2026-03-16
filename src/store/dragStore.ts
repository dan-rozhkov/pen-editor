import { create } from "zustand";
import { useSelectionStore } from "./selectionStore";

export interface DropIndicatorData {
  x: number;
  y: number;
  length: number;
  direction: "horizontal" | "vertical";
}

export interface InsertInfo {
  parentId: string;
  index: number;
}

interface DragState {
  isDragging: boolean;
  draggedNodeId: string | null;
  dropIndicator: DropIndicatorData | null;
  insertInfo: InsertInfo | null;
  isOutsideParent: boolean;
  animationPhase: "dragging" | "dropping" | null;
  cancelDrag: (() => void) | null;

  startDrag: (nodeId: string) => void;
  updateDrop: (
    indicator: DropIndicatorData | null,
    insertInfo: InsertInfo | null,
    isOutsideParent?: boolean,
  ) => void;
  endDrag: () => void;
  setAnimationPhase: (phase: "dragging" | "dropping" | null) => void;
  setCancelDrag: (fn: (() => void) | null) => void;
}

export const useDragStore = create<DragState>((set) => ({
  isDragging: false,
  draggedNodeId: null,
  dropIndicator: null,
  insertInfo: null,
  isOutsideParent: false,
  animationPhase: null,
  cancelDrag: null,

  startDrag: (nodeId) => {
    // Select the node when starting to drag
    useSelectionStore.getState().select(nodeId);

    set({
      isDragging: true,
      draggedNodeId: nodeId,
      dropIndicator: null,
      insertInfo: null,
      isOutsideParent: false,
      animationPhase: "dragging",
    });
  },

  updateDrop: (indicator, insertInfo, isOutsideParent = false) =>
    set({
      dropIndicator: indicator,
      insertInfo,
      isOutsideParent,
    }),

  endDrag: () =>
    set({
      isDragging: false,
      draggedNodeId: null,
      dropIndicator: null,
      insertInfo: null,
      isOutsideParent: false,
      animationPhase: null,
      cancelDrag: null,
    }),

  setAnimationPhase: (phase) => set({ animationPhase: phase }),
  setCancelDrag: (fn) => set({ cancelDrag: fn }),
}));
