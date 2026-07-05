import type { SceneNode } from "@/types/scene";
import { isContainerNode } from "@/types/scene";
import type { GuideLine } from "@/store/smartGuideStore";
import type { Guide } from "@/store/guidesStore";

export interface SnapEdges {
  left: number;
  right: number;
  centerX: number;
  top: number;
  bottom: number;
  centerY: number;
}

export interface SnapTarget {
  edges: SnapEdges;
}

export function getSnapEdges(
  absX: number,
  absY: number,
  width: number,
  height: number,
): SnapEdges {
  return {
    left: absX,
    right: absX + width,
    centerX: absX + width / 2,
    top: absY,
    bottom: absY + height,
    centerY: absY + height / 2,
  };
}

/**
 * Recursively collect snap targets from all visible nodes, excluding specified IDs.
 */
export function collectSnapTargets(
  nodes: SceneNode[],
  excludeIds: Set<string>,
  offsetX = 0,
  offsetY = 0,
): SnapTarget[] {
  const targets: SnapTarget[] = [];

  for (const node of nodes) {
    if (node.visible === false || node.enabled === false) continue;

    const absX = offsetX + node.x;
    const absY = offsetY + node.y;

    if (!excludeIds.has(node.id)) {
      targets.push({
        edges: getSnapEdges(absX, absY, node.width, node.height),
      });
    }

    // Recurse into children of containers
    if (isContainerNode(node)) {
      const childTargets = collectSnapTargets(
        node.children,
        excludeIds,
        absX,
        absY,
      );
      targets.push(...childTargets);
    }
  }

  return targets;
}

interface SnapResult {
  deltaX: number;
  deltaY: number;
  guides: GuideLine[];
}

/**
 * Calculate snap deltas and guide lines for a dragged element.
 * Returns the delta to apply to the dragged position and guide lines to display.
 */
export function calculateSnap(
  draggedEdges: SnapEdges,
  targets: SnapTarget[],
  threshold: number,
): SnapResult {
  let bestDx = Infinity;
  let bestDy = Infinity;
  const xMatches: { position: number; targetEdges: SnapEdges }[] = [];
  const yMatches: { position: number; targetEdges: SnapEdges }[] = [];

  const draggedXValues = [
    draggedEdges.left,
    draggedEdges.centerX,
    draggedEdges.right,
  ];
  const draggedYValues = [
    draggedEdges.top,
    draggedEdges.centerY,
    draggedEdges.bottom,
  ];

  for (const target of targets) {
    const targetXValues = [
      target.edges.left,
      target.edges.centerX,
      target.edges.right,
    ];
    const targetYValues = [
      target.edges.top,
      target.edges.centerY,
      target.edges.bottom,
    ];

    // Check X axis (vertical guide lines)
    for (const dx of draggedXValues) {
      for (const tx of targetXValues) {
        const diff = tx - dx;
        const absDiff = Math.abs(diff);
        if (absDiff < threshold) {
          if (absDiff < Math.abs(bestDx)) {
            bestDx = diff;
            xMatches.length = 0;
            xMatches.push({ position: tx, targetEdges: target.edges });
          } else if (Math.abs(absDiff - Math.abs(bestDx)) < 0.01) {
            xMatches.push({ position: tx, targetEdges: target.edges });
          }
        }
      }
    }

    // Check Y axis (horizontal guide lines)
    for (const dy of draggedYValues) {
      for (const ty of targetYValues) {
        const diff = ty - dy;
        const absDiff = Math.abs(diff);
        if (absDiff < threshold) {
          if (absDiff < Math.abs(bestDy)) {
            bestDy = diff;
            yMatches.length = 0;
            yMatches.push({ position: ty, targetEdges: target.edges });
          } else if (Math.abs(absDiff - Math.abs(bestDy)) < 0.01) {
            yMatches.push({ position: ty, targetEdges: target.edges });
          }
        }
      }
    }
  }

  const guides: GuideLine[] = [];
  const deltaX = Math.abs(bestDx) <= threshold ? bestDx : 0;
  const deltaY = Math.abs(bestDy) <= threshold ? bestDy : 0;

  // Compute snapped dragged edges for guide extent calculation
  const snappedDragged: SnapEdges = {
    left: draggedEdges.left + deltaX,
    right: draggedEdges.right + deltaX,
    centerX: draggedEdges.centerX + deltaX,
    top: draggedEdges.top + deltaY,
    bottom: draggedEdges.bottom + deltaY,
    centerY: draggedEdges.centerY + deltaY,
  };

  // Generate guide lines from axis matches
  function buildGuideLines(
    matches: typeof xMatches,
    orientation: "vertical" | "horizontal",
    snappedMin: number,
    snappedMax: number,
    getMin: (e: SnapEdges) => number,
    getMax: (e: SnapEdges) => number,
  ): void {
    const byPosition = new Map<number, SnapEdges[]>();
    for (const m of matches) {
      const list = byPosition.get(m.position) || [];
      list.push(m.targetEdges);
      byPosition.set(m.position, list);
    }
    for (const [position, edgesList] of byPosition) {
      let min = snappedMin;
      let max = snappedMax;
      for (const edges of edgesList) {
        min = Math.min(min, getMin(edges));
        max = Math.max(max, getMax(edges));
      }
      guides.push({ orientation, position, start: min, end: max });
    }
  }

  if (deltaX !== 0 || (Math.abs(bestDx) <= threshold && bestDx === 0)) {
    buildGuideLines(xMatches, "vertical", snappedDragged.top, snappedDragged.bottom, (e) => e.top, (e) => e.bottom);
  }
  if (deltaY !== 0 || (Math.abs(bestDy) <= threshold && bestDy === 0)) {
    buildGuideLines(yMatches, "horizontal", snappedDragged.left, snappedDragged.right, (e) => e.left, (e) => e.right);
  }

  return { deltaX, deltaY, guides };
}

interface PersistentGuideSnapResult {
  deltaX: number;
  deltaY: number;
}

/**
 * Calculate the snap delta for a dragged element against persistent ruler
 * guides. Unlike `calculateSnap` (node-to-node smart guides), a persistent
 * guide is a single axis + position and has no bounding box, so it only
 * contributes a delta — the guide line itself is already rendered
 * persistently regardless of whether anything is currently snapped to it.
 */
export function calculatePersistentGuideSnap(
  draggedEdges: SnapEdges,
  guides: Guide[],
  threshold: number,
): PersistentGuideSnapResult {
  let bestDx = 0;
  let bestDiffX = threshold;
  let bestDy = 0;
  let bestDiffY = threshold;

  const draggedXValues = [
    draggedEdges.left,
    draggedEdges.centerX,
    draggedEdges.right,
  ];
  const draggedYValues = [
    draggedEdges.top,
    draggedEdges.centerY,
    draggedEdges.bottom,
  ];

  for (const guide of guides) {
    if (guide.orientation === "vertical") {
      for (const dx of draggedXValues) {
        const diff = guide.position - dx;
        const absDiff = Math.abs(diff);
        if (absDiff < bestDiffX) {
          bestDiffX = absDiff;
          bestDx = diff;
        }
      }
    } else {
      for (const dy of draggedYValues) {
        const diff = guide.position - dy;
        const absDiff = Math.abs(diff);
        if (absDiff < bestDiffY) {
          bestDiffY = absDiff;
          bestDy = diff;
        }
      }
    }
  }

  return { deltaX: bestDx, deltaY: bestDy };
}

/**
 * Snap a single absolute coordinate (e.g. a resize handle's moving edge) to
 * the nearest persistent guide on the given axis, within `threshold`.
 * Returns the original value unchanged if no guide is close enough.
 */
export function snapValueToGuides(
  value: number,
  orientation: "vertical" | "horizontal",
  guides: Guide[],
  threshold: number,
): number {
  let best = value;
  let bestDiff = threshold;
  for (const guide of guides) {
    if (guide.orientation !== orientation) continue;
    const diff = Math.abs(guide.position - value);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = guide.position;
    }
  }
  return best;
}
