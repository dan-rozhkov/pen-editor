import type { MeasureLine } from "@/store/measureStore";

export interface NodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute distance lines from a child to all 4 edges of its parent container.
 * Returns up to 4 lines: top, bottom, left, right padding.
 */
export function computeParentDistances(
  child: NodeBounds,
  parent: NodeBounds,
): MeasureLine[] {
  const lines: MeasureLine[] = [];

  const childRight = child.x + child.width;
  const childBottom = child.y + child.height;
  const parentRight = parent.x + parent.width;
  const parentBottom = parent.y + parent.height;

  // Center of the child for line placement
  const childCenterX = child.x + child.width / 2;
  const childCenterY = child.y + child.height / 2;

  // Top: from parent top to child top
  const topDist = Math.round(child.y - parent.y);
  if (topDist !== 0) {
    lines.push({
      orientation: "vertical",
      x: childCenterX,
      y: parent.y,
      length: topDist,
      label: String(Math.abs(topDist)),
    });
  }

  // Bottom: from child bottom to parent bottom
  const bottomDist = Math.round(parentBottom - childBottom);
  if (bottomDist !== 0) {
    lines.push({
      orientation: "vertical",
      x: childCenterX,
      y: childBottom,
      length: bottomDist,
      label: String(Math.abs(bottomDist)),
    });
  }

  // Left: from parent left to child left
  const leftDist = Math.round(child.x - parent.x);
  if (leftDist !== 0) {
    lines.push({
      orientation: "horizontal",
      x: parent.x,
      y: childCenterY,
      length: leftDist,
      label: String(Math.abs(leftDist)),
    });
  }

  // Right: from child right to parent right
  const rightDist = Math.round(parentRight - childRight);
  if (rightDist !== 0) {
    lines.push({
      orientation: "horizontal",
      x: childRight,
      y: childCenterY,
      length: rightDist,
      label: String(Math.abs(rightDist)),
    });
  }

  return lines;
}

/**
 * Compute distance lines between two sibling nodes.
 * Shows horizontal gap (if separated horizontally) and/or vertical gap (if separated vertically).
 */
export function computeSiblingDistances(
  selected: NodeBounds,
  hovered: NodeBounds,
): MeasureLine[] {
  const lines: MeasureLine[] = [];

  const selRight = selected.x + selected.width;
  const selBottom = selected.y + selected.height;
  const hovRight = hovered.x + hovered.width;
  const hovBottom = hovered.y + hovered.height;

  // Horizontal gap
  // Check if there's a horizontal gap between the nodes
  const hGap = computeGap(selected.x, selRight, hovered.x, hovRight);
  if (hGap !== null) {
    // Vertical overlap center for the line y position
    const overlapTop = Math.max(selected.y, hovered.y);
    const overlapBottom = Math.min(selBottom, hovBottom);
    const lineY =
      overlapTop < overlapBottom
        ? (overlapTop + overlapBottom) / 2
        : (selected.y + selected.height / 2 + hovered.y + hovered.height / 2) /
          2;

    lines.push({
      orientation: "horizontal",
      x: hGap.start,
      y: lineY,
      length: hGap.size,
      label: String(Math.round(Math.abs(hGap.size))),
    });
  }

  // Vertical gap
  const vGap = computeGap(selected.y, selBottom, hovered.y, hovBottom);
  if (vGap !== null) {
    // Horizontal overlap center for the line x position
    const overlapLeft = Math.max(selected.x, hovered.x);
    const overlapRight = Math.min(selRight, hovRight);
    const lineX =
      overlapLeft < overlapRight
        ? (overlapLeft + overlapRight) / 2
        : (selected.x +
            selected.width / 2 +
            hovered.x +
            hovered.width / 2) /
          2;

    lines.push({
      orientation: "vertical",
      x: lineX,
      y: vGap.start,
      length: vGap.size,
      label: String(Math.round(Math.abs(vGap.size))),
    });
  }

  return lines;
}

/**
 * Compute the gap between two 1D intervals [aMin, aMax] and [bMin, bMax].
 * Returns { start, size } if there's a gap, null if they overlap.
 */
function computeGap(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): { start: number; size: number } | null {
  if (aMax <= bMin) {
    // a is to the left/above b
    const size = bMin - aMax;
    if (size < 1) return null;
    return { start: aMax, size };
  }
  if (bMax <= aMin) {
    // b is to the left/above a
    const size = aMin - bMax;
    if (size < 1) return null;
    return { start: bMax, size };
  }
  // Overlapping
  return null;
}
