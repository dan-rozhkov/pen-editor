import { create } from "zustand";
import type { PathAnchor } from "@/types/scene";

/**
 * Transient (non-history) state for the Pen tool: the in-progress draft path
 * while actively drawing, plus small hover-highlight state used by the path
 * point-edit-mode overlay/cursor. None of this is scene data — the drawing
 * draft only becomes a real node (via sceneStore.addNode, which saves history
 * itself) once committed; edit-mode point positions live on the node itself
 * and are mutated through sceneStore updateNode/updateNodeWithoutHistory so
 * they participate in undo/redo like every other node edit.
 */

export type HandleRef = { anchorIndex: number; which: "in" | "out" };

interface PenToolState {
  // --- Drawing a brand-new path ---
  isDrafting: boolean;
  anchors: PathAnchor[];
  closed: boolean;
  /** Current cursor position in world space, for the live "next segment" preview. */
  cursorWorld: { x: number; y: number } | null;
  /** The anchor currently being placed (drag-to-smooth in progress), not yet committed to `anchors`. */
  pendingAnchor: PathAnchor | null;

  startDraft: () => void;
  beginPlacingAnchor: (pos: { x: number; y: number }) => void;
  updatePlacingAnchorHandle: (handleOut: { x: number; y: number }) => void;
  commitPendingAnchor: () => void;
  discardPendingAnchor: () => void;
  setCursorWorld: (pos: { x: number; y: number } | null) => void;
  closeDraft: () => void;
  resetDraft: () => void;

  // --- Path edit-mode hover highlight (visual only) ---
  hoveredAnchorIndex: number | null;
  hoveredHandle: HandleRef | null;
  setHoveredAnchor: (index: number | null) => void;
  setHoveredHandle: (handle: HandleRef | null) => void;
}

const IDLE_DRAFT = {
  isDrafting: false,
  anchors: [] as PathAnchor[],
  closed: false,
  cursorWorld: null,
  pendingAnchor: null,
} as const;

export const usePenToolStore = create<PenToolState>((set, get) => ({
  ...IDLE_DRAFT,
  hoveredAnchorIndex: null,
  hoveredHandle: null,

  startDraft: () => set({ ...IDLE_DRAFT, isDrafting: true }),

  beginPlacingAnchor: (pos) => set({ pendingAnchor: { x: pos.x, y: pos.y } }),

  updatePlacingAnchorHandle: (handleOut) => {
    const { pendingAnchor } = get();
    if (!pendingAnchor) return;
    const anchor = { x: pendingAnchor.x, y: pendingAnchor.y };
    set({
      pendingAnchor: {
        ...pendingAnchor,
        handleOut,
        handleIn: {
          x: 2 * anchor.x - handleOut.x,
          y: 2 * anchor.y - handleOut.y,
        },
      },
    });
  },

  commitPendingAnchor: () => {
    const { pendingAnchor, anchors } = get();
    if (!pendingAnchor) return;
    set({ anchors: [...anchors, pendingAnchor], pendingAnchor: null });
  },

  discardPendingAnchor: () => set({ pendingAnchor: null }),

  setCursorWorld: (pos) => set({ cursorWorld: pos }),

  closeDraft: () => set({ closed: true }),

  resetDraft: () => set({ ...IDLE_DRAFT }),

  setHoveredAnchor: (index) => set({ hoveredAnchorIndex: index }),
  setHoveredHandle: (handle) => set({ hoveredHandle: handle }),
}));
