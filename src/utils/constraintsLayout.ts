import type { ConstraintMode, NodeConstraints } from "@/types/scene";

/** A child's position/size along a single axis, relative to its parent frame. */
export interface AxisRect {
  pos: number;
  size: number;
}

const DEFAULT_MODE: ConstraintMode = "min";

/**
 * Recomputes a child's position/size along one axis when its parent frame's
 * size along that axis changes from `oldParentSize` to `newParentSize`.
 * Mirrors Figma's constraint semantics:
 * - `min` (left/top): pinned to the start edge, fixed size.
 * - `max` (right/bottom): pinned to the end edge, fixed size.
 * - `center`: centered offset from the parent's midpoint is preserved.
 * - `stretch` (left & right / top & bottom): both edge margins are preserved,
 *   so size grows/shrinks with the parent.
 * - `scale`: position and size both scale proportionally to the parent's
 *   resize ratio.
 */
export function applyConstraintAxis(
  mode: ConstraintMode | undefined,
  rect: AxisRect,
  oldParentSize: number,
  newParentSize: number,
): AxisRect {
  const delta = newParentSize - oldParentSize;
  switch (mode ?? DEFAULT_MODE) {
    case "max":
      return { pos: rect.pos + delta, size: rect.size };
    case "center": {
      const centerOffset = rect.pos + rect.size / 2 - oldParentSize / 2;
      return { pos: newParentSize / 2 + centerOffset - rect.size / 2, size: rect.size };
    }
    case "stretch":
      return { pos: rect.pos, size: Math.max(0, rect.size + delta) };
    case "scale": {
      if (oldParentSize === 0) return { pos: rect.pos, size: rect.size };
      const scale = newParentSize / oldParentSize;
      return { pos: rect.pos * scale, size: rect.size * scale };
    }
    case "min":
    default:
      return { pos: rect.pos, size: rect.size };
  }
}

/**
 * Toggles one pinned edge of an axis constraint, mirroring Figma's
 * classic-cross widget: pinning both edges collapses into `stretch`,
 * pinning neither collapses into `center`. Clicking an edge while in
 * `scale` mode starts fresh, pinning just that edge.
 */
export function toggleConstraintEdge(
  mode: ConstraintMode,
  edge: "start" | "end",
): ConstraintMode {
  if (mode === "scale") {
    return edge === "start" ? "min" : "max";
  }
  const pinStart = mode === "min" || mode === "stretch";
  const pinEnd = mode === "max" || mode === "stretch";
  const newPinStart = edge === "start" ? !pinStart : pinStart;
  const newPinEnd = edge === "end" ? !pinEnd : pinEnd;
  if (newPinStart && newPinEnd) return "stretch";
  if (newPinStart) return "min";
  if (newPinEnd) return "max";
  return "center";
}

export interface ConstrainableRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParentSize {
  width: number;
  height: number;
}

/** Recomputes a child's full rect (both axes) against its parent's old/new size. */
export function computeConstrainedRect(
  rect: ConstrainableRect,
  constraints: NodeConstraints | undefined,
  oldParent: ParentSize,
  newParent: ParentSize,
): ConstrainableRect {
  const h = applyConstraintAxis(
    constraints?.horizontal,
    { pos: rect.x, size: rect.width },
    oldParent.width,
    newParent.width,
  );
  const v = applyConstraintAxis(
    constraints?.vertical,
    { pos: rect.y, size: rect.height },
    oldParent.height,
    newParent.height,
  );
  return { x: h.pos, y: v.pos, width: h.size, height: v.size };
}
