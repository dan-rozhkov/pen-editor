import { useViewportStore } from "@/store/viewportStore";
import type { InteractionContext } from "./types";

// A single active touch point — only the coordinates we need. Real TouchEvents
// satisfy this; tests pass plain objects.
interface TouchPoint {
  clientX: number;
  clientY: number;
}

// Minimal shape of the touch events we consume. Keeps the controller testable
// without a full DOM TouchEvent (happy-dom has no real touch support).
export interface MinimalTouchEvent {
  touches: ArrayLike<TouchPoint>;
  preventDefault?: () => void;
  /** "touchcancel" suppresses tap-select on a lifted single finger; omit (or
   * "touchend") for a normal lift. */
  type?: string;
}

/** Callbacks the touch controller needs but shouldn't own directly, so it
 * stays testable with plain objects instead of pulling in the scene/selection
 * stores itself. */
export interface TouchControllerDeps {
  /** Perform the tap-select side effect (hit-test + select/clear) for a
   * single-finger tap at the given world point. */
  onTap: (world: { x: number; y: number }) => void;
}

export interface TouchController {
  handleTouchStart(e: MinimalTouchEvent): boolean;
  handleTouchMove(e: MinimalTouchEvent): boolean;
  handleTouchEnd(e: MinimalTouchEvent): boolean;
  /**
   * True while a touch gesture "owns" the canvas — from the moment a second
   * finger lands until every finger lifts. The pointer-event handlers gate on
   * this so a leftover finger can't start a drag/marquee after a pinch.
   */
  isGesturing: () => boolean;
  destroy(): void;
}

interface GestureState {
  // Owns the canvas while ≥2 fingers have touched and not all have lifted yet.
  consuming: boolean;
  lastMidX: number;
  lastMidY: number;
  lastDist: number;
}

type SingleTouchMode = "idle" | "pending" | "panning";

interface SingleTouchState {
  mode: SingleTouchMode;
  startX: number;
  startY: number;
  // Last known canvas-relative position of the tracked finger — used both to
  // compute the next pan delta and, if the finger lifts without ever passing
  // the pan threshold, as the tap point (touchend has no coordinates of its
  // own once the last finger lifts).
  lastX: number;
  lastY: number;
}

// Screen-space movement allowed between touchstart and touchend for a
// single-finger gesture to still count as a tap rather than a pan. Mirrors
// CLICK_MOVE_THRESHOLD_PX used for mouse clicks in pixiInteractionCore.
const SINGLE_TOUCH_PAN_THRESHOLD_PX = 5;

/**
 * Touch input for the canvas: two-finger pan + pinch-to-zoom (Figma-style),
 * plus single-finger pan-to-navigate with tap-to-select — touch is read-only
 * navigation, so a single finger never drags a node, resizes, marquees, or
 * draws. A second finger landing mid single-finger-pan hands off seamlessly
 * into the pinch gesture (baseline is re-derived from the live touches, so
 * there's no viewport jump).
 */
export function createTouchController(
  context: InteractionContext,
  deps: TouchControllerDeps,
): TouchController {
  const state: GestureState = {
    consuming: false,
    lastMidX: 0,
    lastMidY: 0,
    lastDist: 0,
  };

  const single: SingleTouchState = {
    mode: "idle",
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  };

  // Midpoint (canvas-relative) and finger separation for the first two touches.
  function measure(touches: ArrayLike<TouchPoint>): {
    midX: number;
    midY: number;
    dist: number;
  } {
    const rect = context.canvas.getBoundingClientRect();
    const a = touches[0];
    const b = touches[1];
    const midX = (a.clientX + b.clientX) / 2 - rect.left;
    const midY = (a.clientY + b.clientY) / 2 - rect.top;
    const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    return { midX, midY, dist };
  }

  function canvasPoint(touch: TouchPoint): { x: number; y: number } {
    const rect = context.canvas.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }

  function syncBaseline(touches: ArrayLike<TouchPoint>): void {
    const { midX, midY, dist } = measure(touches);
    state.lastMidX = midX;
    state.lastMidY = midY;
    state.lastDist = dist;
  }

  function endGesture(): void {
    if (!state.consuming) return;
    state.consuming = false;
    useViewportStore.getState().setIsPanning(false);
  }

  function resetSingle(): void {
    single.mode = "idle";
  }

  return {
    handleTouchStart(e: MinimalTouchEvent): boolean {
      if (e.touches.length >= 2) {
        e.preventDefault?.();
        syncBaseline(e.touches);
        if (!state.consuming) {
          state.consuming = true;
          useViewportStore.getState().setIsPanning(true);
        }
        // Hand off from any in-flight single-finger gesture — the pinch
        // baseline above was just re-derived from the live touches, so there
        // is nothing left for the single-finger state to finish.
        resetSingle();
        return true;
      }

      if (e.touches.length === 1 && !state.consuming) {
        e.preventDefault?.();
        const p = canvasPoint(e.touches[0]);
        single.mode = "pending";
        single.startX = p.x;
        single.startY = p.y;
        single.lastX = p.x;
        single.lastY = p.y;
      }

      return false;
    },

    handleTouchMove(e: MinimalTouchEvent): boolean {
      if (state.consuming) {
        if (e.touches.length < 2) return false;
        e.preventDefault?.();

        const { midX, midY, dist } = measure(e.touches);

        // Pan by how far the midpoint moved.
        const dx = midX - state.lastMidX;
        const dy = midY - state.lastMidY;
        if (dx !== 0 || dy !== 0) {
          const vs = useViewportStore.getState();
          vs.setPosition(vs.x + dx, vs.y + dy);
        }

        // Zoom by the change in finger separation, anchored at the midpoint.
        if (state.lastDist > 0 && dist > 0) {
          const factor = dist / state.lastDist;
          if (factor !== 1) {
            const vs = useViewportStore.getState();
            vs.zoomAtPoint(vs.scale * factor, midX, midY);
          }
        }

        state.lastMidX = midX;
        state.lastMidY = midY;
        state.lastDist = dist;
        return true;
      }

      if (e.touches.length === 1 && single.mode !== "idle") {
        const p = canvasPoint(e.touches[0]);

        if (single.mode === "pending") {
          const dx0 = p.x - single.startX;
          const dy0 = p.y - single.startY;
          if (Math.hypot(dx0, dy0) < SINGLE_TOUCH_PAN_THRESHOLD_PX) {
            single.lastX = p.x;
            single.lastY = p.y;
            return true;
          }
          single.mode = "panning";
          useViewportStore.getState().setIsPanning(true);
        }

        e.preventDefault?.();
        const dx = p.x - single.lastX;
        const dy = p.y - single.lastY;
        if (dx !== 0 || dy !== 0) {
          const vs = useViewportStore.getState();
          vs.setPosition(vs.x + dx, vs.y + dy);
        }
        single.lastX = p.x;
        single.lastY = p.y;
        return true;
      }

      return false;
    },

    handleTouchEnd(e: MinimalTouchEvent): boolean {
      if (state.consuming) {
        if (e.touches.length >= 2) {
          // Dropped from 3→2 fingers: re-baseline so the next move doesn't jump.
          syncBaseline(e.touches);
          return true;
        }
        if (e.touches.length === 0) {
          endGesture();
        }
        // Exactly one finger left: keep consuming (so it can't start a drag) but
        // pause pan/zoom until it lifts or a second finger returns.
        return true;
      }

      if (single.mode !== "idle") {
        const wasPanning = single.mode === "panning";
        const tapX = single.lastX;
        const tapY = single.lastY;
        resetSingle();

        if (wasPanning) {
          useViewportStore.getState().setIsPanning(false);
          return true;
        }

        // A cancelled touch (scroll hijack, OS interrupt) is never a tap.
        if (e.type !== "touchcancel") {
          deps.onTap(context.screenToWorld(tapX, tapY));
        }
        return true;
      }

      return false;
    },

    isGesturing: () => state.consuming,

    destroy(): void {
      endGesture();
      resetSingle();
    },
  };
}
