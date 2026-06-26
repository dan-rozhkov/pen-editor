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

/**
 * Two-finger pan + pinch-to-zoom for touch screens (iPad, phones), mirroring
 * Figma: drag two fingers to pan, pinch to zoom around the gesture midpoint.
 * Single-finger touches fall through to the normal pointer flow (select/drag).
 */
export function createTouchController(context: InteractionContext): TouchController {
  const state: GestureState = {
    consuming: false,
    lastMidX: 0,
    lastMidY: 0,
    lastDist: 0,
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

  return {
    handleTouchStart(e: MinimalTouchEvent): boolean {
      if (e.touches.length >= 2) {
        e.preventDefault?.();
        syncBaseline(e.touches);
        if (!state.consuming) {
          state.consuming = true;
          useViewportStore.getState().setIsPanning(true);
        }
        return true;
      }
      return false;
    },

    handleTouchMove(e: MinimalTouchEvent): boolean {
      if (!state.consuming || e.touches.length < 2) return false;
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
    },

    handleTouchEnd(e: MinimalTouchEvent): boolean {
      if (!state.consuming) return false;
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
    },

    isGesturing: () => state.consuming,

    destroy(): void {
      endGesture();
    },
  };
}
