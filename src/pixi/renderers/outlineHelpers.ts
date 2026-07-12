import type { Graphics } from "pixi.js";
import { useRenderModeStore } from "@/store/renderModeStore";
import { useViewportStore } from "@/store/viewportStore";
import { SELECTION_COLOR } from "@/pixi/selectionOverlay/constants";

/**
 * Outline-mode wireframe stroke color — the same accent blue the selection
 * overlay uses, imported (not copied) so wireframe strokes track the editor
 * accent if it ever changes.
 */
export const OUTLINE_STROKE_COLOR = SELECTION_COLOR;

/**
 * True when the canvas should render wireframe-only (outline mode): no
 * fills, images, patterns, shaders, video, shadows, blurs or masks — just a
 * thin stroke of each node's geometry. Read untracked: callers run inside a
 * Pixi render/sync pass (not a React render), so there is nothing to
 * subscribe to here — `pixiSync.ts` triggers a full rebuild whenever the
 * store changes, which is what makes every renderer re-evaluate this flag.
 */
export function isOutlineRenderMode(): boolean {
  return useRenderModeStore.getState().renderMode === "outline";
}

/**
 * Stroke width that stays ~1px on screen regardless of the current viewport
 * zoom (matches the idiom used by the selection/hover overlays, e.g.
 * `selectionOverlay/helpers.ts`'s `gfx.stroke({ width: 1 / scale })`).
 */
export function getOutlineStrokeWidth(): number {
  const scale = useViewportStore.getState().scale || 1;
  return 1 / scale;
}

/**
 * Stroke the Graphics' current path with the outline-mode style. Call after
 * building the path (moveTo/lineTo/rect/roundRect/poly/etc) — do NOT call
 * `.fill()` first, outline mode never fills.
 */
export function strokeOutlinePath(gfx: Graphics): void {
  gfx.stroke({ color: OUTLINE_STROKE_COLOR, width: getOutlineStrokeWidth(), alpha: 1 });
}

/** Draw + stroke a plain bounding-box rectangle — the fallback outline for
 * node types with no more specific geometry (text bbox, embed bbox, etc). */
export function drawOutlineBBox(gfx: Graphics, width: number, height: number): void {
  gfx.rect(0, 0, width, height);
  strokeOutlinePath(gfx);
}
