import type { TextNode } from "@/types/scene";
import { preparePath } from "@/utils/pathMeasure";

/**
 * Pure geometry for the on-canvas `startOffset` drag handle (the "blue
 * handle" the spec calls for — see `p2-11-text-on-path.md` section 4).
 * Mirrors `pathEditGeometry.ts`'s split between pure math (here, unit-tested
 * without Pixi) and store/Pixi wiring (`textPathOffsetController.ts`).
 *
 * `textPath.points` are stored directly in the node's local 0..width/
 * 0..height box with no separate `geometryBounds` scale field (see
 * `textPathHitTest.ts`'s doc comment), so — unlike `pathEditGeometry.ts`'s
 * `anchorToWorld`, which has to account for a `PathNode`'s possible
 * non-uniform scale — the handle's world position is simply the node's
 * absolute position plus the local point, no scaling involved.
 */

export type TextPath = NonNullable<TextNode["textPath"]>;

/** World-space position of the start-offset handle, or null if the path has zero length (nothing to place a handle on). */
export function getStartOffsetHandleWorldPos(
  tp: TextPath,
  absPos: { x: number; y: number },
): { x: number; y: number } | null {
  if (tp.points.length === 0) return null;
  const prepared = preparePath(tp.points, tp.closed ?? false);
  const clampedOffset = Math.max(0, Math.min(1, tp.startOffset ?? 0));
  const point = prepared.getPointAtLength(clampedOffset * prepared.totalLength);
  return { x: absPos.x + point.x, y: absPos.y + point.y };
}

/** True when `(worldX, worldY)` is within `radius` of the handle's current world position. */
export function hitTestStartOffsetHandle(
  tp: TextPath,
  absPos: { x: number; y: number },
  worldX: number,
  worldY: number,
  radius: number,
): boolean {
  const handlePos = getStartOffsetHandleWorldPos(tp, absPos);
  if (!handlePos) return false;
  const dx = worldX - handlePos.x;
  const dy = worldY - handlePos.y;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * The `startOffset` (0..1) whose handle position is closest to a world
 * point — used while dragging the handle: the pointer's world position is
 * projected onto the curve (by arc length) and converted back to the 0..1
 * fraction `textPath.startOffset` stores. Returns the current offset
 * unchanged for a zero-length path (nothing to project onto).
 */
export function offsetFromWorldPoint(
  tp: TextPath,
  absPos: { x: number; y: number },
  worldX: number,
  worldY: number,
): number {
  // Built once per call (this fires on every pointermove while dragging the
  // handle) and reused for the closest-point search's ~250 internal probes —
  // see `@/utils/pathMeasure`'s doc comment on why a hot caller must hold a
  // single `PreparedPath` rather than go through the one-shot
  // `getTotalLength`/`getClosestPointOnPath` wrappers per probe.
  const prepared = preparePath(tp.points, tp.closed ?? false);
  if (prepared.totalLength <= 0) return Math.max(0, Math.min(1, tp.startOffset ?? 0));
  const localX = worldX - absPos.x;
  const localY = worldY - absPos.y;
  const closest = prepared.getClosestPoint(localX, localY);
  if (!closest) return Math.max(0, Math.min(1, tp.startOffset ?? 0));
  return Math.max(0, Math.min(1, closest.length / prepared.totalLength));
}
