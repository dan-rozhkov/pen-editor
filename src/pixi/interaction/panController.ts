import { useViewportStore } from "@/store/viewportStore";
import type { InteractionContext, PanState } from "./types";

const DRAG_PAN_SPEED = 1.35;
const WHEEL_PAN_SPEED = 1.2;

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
    lastClientX: 0,
    lastClientY: 0,
    panRafId: null,
  };

  const flushPanPosition = (): void => {
    const dx = (state.lastClientX - state.startX) * DRAG_PAN_SPEED;
    const dy = (state.lastClientY - state.startY) * DRAG_PAN_SPEED;
    useViewportStore
      .getState()
      .setPosition(state.startViewX + dx, state.startViewY + dy);
    state.panRafId = null;
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
        state.lastClientX = e.clientX;
        state.lastClientY = e.clientY;
        if (state.panRafId !== null) {
          cancelAnimationFrame(state.panRafId);
          state.panRafId = null;
        }
        useViewportStore.getState().setIsPanning(true);
        context.canvas.style.cursor = "grabbing";
        return true;
      }
      return false;
    },

    handlePointerMove(e: PointerEvent): boolean {
      if (state.isPanning) {
        state.lastClientX = e.clientX;
        state.lastClientY = e.clientY;
        if (state.panRafId === null) {
          state.panRafId = requestAnimationFrame(flushPanPosition);
        }
        return true;
      }
      return false;
    },

    handlePointerUp(_e: PointerEvent): boolean {
      if (state.isPanning) {
        state.isPanning = false;
        if (state.panRafId !== null) {
          cancelAnimationFrame(state.panRafId);
          state.panRafId = null;
        }
        flushPanPosition();
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
        const dx = (e.shiftKey ? -e.deltaY : -e.deltaX) * WHEEL_PAN_SPEED;
        const dy = (e.shiftKey ? 0 : -e.deltaY) * WHEEL_PAN_SPEED;
        vs.setPosition(vs.x + dx, vs.y + dy);
      }
    },

    isPanning: () => state.isPanning,
  };
}
