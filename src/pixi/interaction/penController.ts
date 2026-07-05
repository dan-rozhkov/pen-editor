import { useDrawModeStore } from "@/store/drawModeStore";
import { usePenToolStore } from "@/store/penToolStore";
import { useViewportStore } from "@/store/viewportStore";
import { isNearWorldPoint } from "./pathEditGeometry";
import { finishPenDraft } from "./penDraftCommit";
import { DRAG_CLICK_THRESHOLD } from "./dragController";
import type { InteractionContext } from "./types";

export interface PenController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerUp(e: PointerEvent, world: { x: number; y: number }): boolean;
  isDrawing: () => boolean;
}

export function createPenController(_context: InteractionContext): PenController {
  let isPlacingAnchor = false;
  let anchorStartWorld = { x: 0, y: 0 };
  let dragExceededThreshold = false;

  return {
    handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean {
      const { activeTool } = useDrawModeStore.getState();
      if (activeTool !== "pen" || e.button !== 0) return false;

      const pen = usePenToolStore.getState();
      const scale = useViewportStore.getState().scale || 1;

      if (pen.isDrafting && pen.anchors.length >= 2 && isNearWorldPoint(world.x, world.y, pen.anchors[0], scale)) {
        // Click on the first anchor closes the contour and finalizes the path.
        finishPenDraft(true);
        return true;
      }

      if (!pen.isDrafting) {
        pen.startDraft();
      }

      isPlacingAnchor = true;
      dragExceededThreshold = false;
      anchorStartWorld = world;
      pen.beginPlacingAnchor(world);
      return true;
    },

    handlePointerMove(_e: PointerEvent, world: { x: number; y: number }): boolean {
      const pen = usePenToolStore.getState();
      if (!pen.isDrafting) return false;

      if (isPlacingAnchor) {
        const dx = world.x - anchorStartWorld.x;
        const dy = world.y - anchorStartWorld.y;
        // Movement (in world units) beyond which a click-and-hold becomes a
        // click-drag (smooth anchor) rather than a plain click (corner anchor).
        if (dragExceededThreshold || Math.hypot(dx, dy) > DRAG_CLICK_THRESHOLD) {
          dragExceededThreshold = true;
          pen.updatePlacingAnchorHandle(world);
        }
        return true;
      }

      pen.setCursorWorld(world);
      return true;
    },

    handlePointerUp(_e: PointerEvent, _world: { x: number; y: number }): boolean {
      const pen = usePenToolStore.getState();
      if (!pen.isDrafting || !isPlacingAnchor) return false;

      isPlacingAnchor = false;
      pen.commitPendingAnchor();
      return true;
    },

    isDrawing: () => usePenToolStore.getState().isDrafting,
  };
}
