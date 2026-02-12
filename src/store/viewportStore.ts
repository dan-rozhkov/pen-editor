import { create } from "zustand";
import type { SceneNode } from "../types/scene";
import { calculateNodesBounds } from "../utils/viewportUtils";

interface ViewportState {
  scale: number;
  x: number;
  y: number;
  isPanning: boolean;
  // Smooth zoom animation state
  targetScale: number;
  zoomCenterX: number;
  zoomCenterY: number;
  animationFrameId: number | null;
  setScale: (scale: number) => void;
  setPosition: (x: number, y: number) => void;
  setIsPanning: (isPanning: boolean) => void;
  zoomAtPoint: (newScale: number, pointX: number, pointY: number) => void;
  startSmoothZoom: (
    zoomDelta: number,
    centerX: number,
    centerY: number,
  ) => void;
  stopAnimation: () => void;
  fitToContent: (
    nodes: SceneNode[],
    viewportWidth: number,
    viewportHeight: number,
  ) => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;

// Smooth zoom animation constants
const EASING_FACTOR = 0.9; // Interpolation speed (higher = faster, max ~0.9)
const ZOOM_THRESHOLD = 0.002; // Animation completion threshold
const ZOOM_INTENSITY = 0.008; // Wheel sensitivity (higher = bigger zoom steps)

export const useViewportStore = create<ViewportState>((set, get) => ({
  scale: 1,
  x: 0,
  y: 0,
  isPanning: false,
  // Smooth zoom animation initial state
  targetScale: 1,
  zoomCenterX: 0,
  zoomCenterY: 0,
  animationFrameId: null,

  setScale: (scale) =>
    set({ scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) }),

  setPosition: (x, y) => set({ x, y }),

  setIsPanning: (isPanning) => set({ isPanning }),

  zoomAtPoint: (newScale, pointX, pointY) => {
    const { scale, x, y } = get();
    const clampedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));

    // Calculate the point in world coordinates before zoom
    const worldX = (pointX - x) / scale;
    const worldY = (pointY - y) / scale;

    // After zoom, we want the same world point to be under the cursor
    // newX + worldX * newScale = pointX
    const newX = pointX - worldX * clampedScale;
    const newY = pointY - worldY * clampedScale;

    set({ scale: clampedScale, x: newX, y: newY });
  },

  startSmoothZoom: (zoomDelta, centerX, centerY) => {
    const state = get();

    // Calculate zoom multiplier from wheel delta
    const zoomMultiplier = Math.exp(-zoomDelta * ZOOM_INTENSITY);

    // Accumulate target scale (if animation is running, build on current target)
    const baseScale =
      state.animationFrameId !== null ? state.targetScale : state.scale;
    const newTargetScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, baseScale * zoomMultiplier),
    );

    // Update zoom center to latest cursor position
    set({
      targetScale: newTargetScale,
      zoomCenterX: centerX,
      zoomCenterY: centerY,
    });

    // Start animation if not already running
    if (state.animationFrameId === null) {
      const tick = () => {
        const { scale, targetScale, zoomCenterX, zoomCenterY, x, y } = get();

        const diff = targetScale - scale;
        const relativeError = Math.abs(diff / scale);

        if (relativeError < ZOOM_THRESHOLD) {
          // Animation complete - apply exact target values
          const worldX = (zoomCenterX - x) / scale;
          const worldY = (zoomCenterY - y) / scale;
          const finalX = zoomCenterX - worldX * targetScale;
          const finalY = zoomCenterY - worldY * targetScale;
          set({
            scale: targetScale,
            x: finalX,
            y: finalY,
            animationFrameId: null,
          });
          return;
        }

        // Interpolate with easing
        const newScale = scale + diff * EASING_FACTOR;

        // Recalculate position to keep zoom centered on cursor
        const worldX = (zoomCenterX - x) / scale;
        const worldY = (zoomCenterY - y) / scale;
        const newX = zoomCenterX - worldX * newScale;
        const newY = zoomCenterY - worldY * newScale;

        const frameId = requestAnimationFrame(tick);
        set({ scale: newScale, x: newX, y: newY, animationFrameId: frameId });
      };

      const frameId = requestAnimationFrame(tick);
      set({ animationFrameId: frameId });
    }
  },

  stopAnimation: () => {
    const { animationFrameId } = get();
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      set({ animationFrameId: null });
    }
  },

  fitToContent: (nodes, viewportWidth, viewportHeight) => {
    const bounds = calculateNodesBounds(nodes);

    // If no content, reset to default view
    if (bounds.isEmpty) {
      set({ scale: 1, x: viewportWidth / 2, y: viewportHeight / 2 });
      return;
    }

    const padding = 50; // Padding around content

    const contentWidth = bounds.maxX - bounds.minX + padding * 2;
    const contentHeight = bounds.maxY - bounds.minY + padding * 2;

    // Calculate scale to fit content
    const scaleX = viewportWidth / contentWidth;
    const scaleY = viewportHeight / contentHeight;
    const newScale = Math.min(
      Math.max(Math.min(scaleX, scaleY), MIN_SCALE),
      MAX_SCALE,
    );

    // Center the content
    const centerX = bounds.minX + (bounds.maxX - bounds.minX) / 2;
    const centerY = bounds.minY + (bounds.maxY - bounds.minY) / 2;

    const newX = viewportWidth / 2 - centerX * newScale;
    const newY = viewportHeight / 2 - centerY * newScale;

    set({ scale: newScale, x: newX, y: newY });
  },
}));
