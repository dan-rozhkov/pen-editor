import { useViewportStore } from "@/store/viewportStore";
import type { InteractionContext, PanState } from "./types";

export interface PanController {
  handlePointerDown(e: PointerEvent): boolean;
  handlePointerMove(e: PointerEvent): boolean;
  handlePointerUp(e: PointerEvent): boolean;
  handleWheel(e: WheelEvent): void;
  isPanning: () => boolean;
}

export function createPanController(context: InteractionContext): PanController {
  const state: PanState = {
    isPanning: false,
    startX: 0,
    startY: 0,
    startViewX: 0,
    startViewY: 0,
  };

  return {
    handlePointerDown(e: PointerEvent): boolean {
      // Middle mouse button or Space+click -> pan
      if (e.button === 1 || (context.isSpaceHeld() && e.button === 0)) {
        state.isPanning = true;
        state.startX = e.clientX;
        state.startY = e.clientY;
        const vs = useViewportStore.getState();
        state.startViewX = vs.x;
        state.startViewY = vs.y;
        useViewportStore.getState().setIsPanning(true);
        context.canvas.style.cursor = "grabbing";
        return true;
      }
      return false;
    },

    handlePointerMove(e: PointerEvent): boolean {
      if (state.isPanning) {
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        useViewportStore.getState().setPosition(
          state.startViewX + dx,
          state.startViewY + dy,
        );
        return true;
      }
      return false;
    },

    handlePointerUp(_e: PointerEvent): boolean {
      if (state.isPanning) {
        state.isPanning = false;
        useViewportStore.getState().setIsPanning(false);
        context.canvas.style.cursor = "";
        return true;
      }
      return false;
    },

    handleWheel(e: WheelEvent): void {
      e.preventDefault();

      const rect = context.canvas.getBoundingClientRect();
      const centerX = e.clientX - rect.left;
      const centerY = e.clientY - rect.top;

      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom
        useViewportStore.getState().startSmoothZoom(e.deltaY, centerX, centerY);
      } else {
        // Two-finger scroll = pan (matches Konva behavior)
        const vs = useViewportStore.getState();
        const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
        const dy = e.shiftKey ? 0 : -e.deltaY;
        vs.setPosition(vs.x + dx, vs.y + dy);
      }
    },

    isPanning: () => state.isPanning,
  };
}
