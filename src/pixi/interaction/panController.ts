import { useViewportStore } from "@/store/viewportStore";
import type { InteractionContext, PanState } from "./types";

// 1:1 like Figma — the grabbed canvas point stays locked under the cursor.
const DRAG_PAN_SPEED = 1;
const WHEEL_PAN_SPEED = 1.5;

// deltaMode normalization: Firefox reports wheel deltas in lines (1) or pages (2).
const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_PAGE_HEIGHT_PX = 800;

function wheelDeltaScale(e: WheelEvent): number {
  if (e.deltaMode === 1) return WHEEL_LINE_HEIGHT_PX;
  if (e.deltaMode === 2) return WHEEL_PAGE_HEIGHT_PX;
  return 1;
}

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

  // Wheel-pan deltas are accumulated and flushed once per frame. Trackpads emit
  // several wheel events per frame; applying each one synchronously runs every
  // viewport-store subscriber (culling, overlays, React) per event while PixiJS
  // only renders once per frame anyway.
  let wheelDX = 0;
  let wheelDY = 0;
  let wheelRafId: number | null = null;

  const flushWheelPan = (): void => {
    wheelRafId = null;
    const dx = wheelDX;
    const dy = wheelDY;
    wheelDX = 0;
    wheelDY = 0;
    if (dx === 0 && dy === 0) return;
    const vs = useViewportStore.getState();
    vs.setPosition(vs.x + dx, vs.y + dy);
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

      const deltaScale = wheelDeltaScale(e);
      const deltaX = e.deltaX * deltaScale;
      const deltaY = e.deltaY * deltaScale;

      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom. getBoundingClientRect is only needed here — it forces
        // layout, so keep it out of the high-frequency pan path.
        const rect = context.canvas.getBoundingClientRect();
        const centerX = e.clientX - rect.left;
        const centerY = e.clientY - rect.top;
        useViewportStore.getState().startSmoothZoom(deltaY, centerX, centerY);
      } else {
        // Two-finger scroll = pan; accumulate and apply once per frame.
        wheelDX += (e.shiftKey ? -deltaY : -deltaX) * WHEEL_PAN_SPEED;
        wheelDY += (e.shiftKey ? 0 : -deltaY) * WHEEL_PAN_SPEED;
        if (wheelRafId === null) {
          wheelRafId = requestAnimationFrame(flushWheelPan);
        }
      }
    },

    isPanning: () => state.isPanning,
  };
}
