import type { TransformHandle } from "./types";

export interface HandleHitGeometry {
  corner: TransformHandle;
  absX: number;
  absY: number;
  width: number;
  height: number;
}

export interface HandleDragOrigin {
  startNodeX: number;
  startNodeY: number;
  startNodeW: number;
  startNodeH: number;
  absX: number;
  absY: number;
  parentOffsetX: number;
  parentOffsetY: number;
}

/**
 * Derive the pointer-down drag-origin snapshot for a resize/scale handle
 * drag: the node's start position/size plus its absolute position and the
 * parent-local↔absolute offset used to convert live pointer deltas back to
 * the node's own coordinate space. Shared by `transformController` and
 * `scaleController`.
 */
export function computeHandleDragOrigin(
  node: { x: number; y: number },
  handleHit: HandleHitGeometry,
): HandleDragOrigin {
  return {
    startNodeX: node.x,
    startNodeY: node.y,
    startNodeW: handleHit.width,
    startNodeH: handleHit.height,
    absX: handleHit.absX,
    absY: handleHit.absY,
    parentOffsetX: handleHit.absX - node.x,
    parentOffsetY: handleHit.absY - node.y,
  };
}
