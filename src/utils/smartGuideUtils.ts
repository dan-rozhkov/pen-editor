import type { SceneNode, FrameNode } from "@/types/scene";
import { isContainerNode } from "@/types/scene";
import type { GuideLine } from "@/store/smartGuideStore";

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
    if (node.visible === false) continue;

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

  // Generate vertical guide lines (X-axis matches)
  if (deltaX !== 0 || (Math.abs(bestDx) <= threshold && bestDx === 0)) {
    // Group matches by position
    const byPosition = new Map<number, SnapEdges[]>();
    for (const m of xMatches) {
      const list = byPosition.get(m.position) || [];
      list.push(m.targetEdges);
      byPosition.set(m.position, list);
    }

    for (const [position, edgesList] of byPosition) {
      let minY = snappedDragged.top;
      let maxY = snappedDragged.bottom;
      for (const edges of edgesList) {
        minY = Math.min(minY, edges.top);
        maxY = Math.max(maxY, edges.bottom);
      }
      guides.push({
        orientation: "vertical",
        position,
        start: minY,
        end: maxY,
      });
    }
  }

  // Generate horizontal guide lines (Y-axis matches)
  if (deltaY !== 0 || (Math.abs(bestDy) <= threshold && bestDy === 0)) {
    const byPosition = new Map<number, SnapEdges[]>();
    for (const m of yMatches) {
      const list = byPosition.get(m.position) || [];
      list.push(m.targetEdges);
      byPosition.set(m.position, list);
    }

    for (const [position, edgesList] of byPosition) {
      let minX = snappedDragged.left;
      let maxX = snappedDragged.right;
      for (const edges of edgesList) {
        minX = Math.min(minX, edges.left);
        maxX = Math.max(maxX, edges.right);
      }
      guides.push({
        orientation: "horizontal",
        position,
        start: minX,
        end: maxX,
      });
    }
  }

  return { deltaX, deltaY, guides };
}
