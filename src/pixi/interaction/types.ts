export type HandleCorner = "tl" | "tr" | "bl" | "br";
export type HandleSide = "l" | "r" | "t" | "b";
export type TransformHandle = HandleCorner | HandleSide;

import type { SnapTarget } from "@/utils/smartGuideUtils";
import type { NodeConstraints } from "@/types/scene";

export interface DragItem {
  id: string;
  startNodeX: number;
  startNodeY: number;
  startAbsX: number;
  startAbsY: number;
  parentOffsetX: number;
  parentOffsetY: number;
  width: number;
  height: number;
}

export interface DragState {
  isDragging: boolean;
  nodeId: string | null;
  dragItems: DragItem[];
  startWorldX: number;
  startWorldY: number;
  startNodeX: number;
  startNodeY: number;
  parentOffsetX: number;
  parentOffsetY: number;
  startBoundsX: number;
  startBoundsY: number;
  startBoundsWidth: number;
  startBoundsHeight: number;
  snapTargets: SnapTarget[];
  snapOffsetX: number;
  snapOffsetY: number;
  // Auto-layout drag reordering
  isAutoLayoutDrag: boolean;
  autoLayoutParentId: string | null;
  // Axis lock state
  isShiftHeld: boolean;
  isAltHeld: boolean;
  axisLock: "x" | "y" | null;
  cumulativeDeltaX: number;
  cumulativeDeltaY: number;
}

export interface PanState {
  isPanning: boolean;
  startX: number;
  startY: number;
  startViewX: number;
  startViewY: number;
  lastClientX: number;
  lastClientY: number;
  panRafId: number | null;
}

export interface DrawState {
  isDrawing: boolean;
  startWorldX: number;
  startWorldY: number;
}

export interface MarqueeState {
  isActive: boolean;
  startWorldX: number;
  startWorldY: number;
  shiftHeld: boolean;
  preShiftIds: string[];
}

export interface TransformState {
  isTransforming: boolean;
  nodeId: string | null;
  corner: TransformHandle | null;
  startNodeX: number;
  startNodeY: number;
  startNodeW: number;
  startNodeH: number;
  /** Absolute position of the node */
  absX: number;
  absY: number;
  parentOffsetX: number;
  parentOffsetY: number;
  /** Original line points at drag start (for scaling during resize) */
  startLinePoints: number[] | null;
  /** Instance slot context (when resizing a slot inside an instance) */
  slotContext: { instanceId: string; descendantPath: string } | null;
  /**
   * Snapshot of direct children (with their constraints) of a non-auto-layout
   * frame being resized, captured at pointer-down. Null when the resized node
   * isn't such a frame, or has no children. Recomputed relative to this
   * snapshot (not incrementally) so repeated drags stay numerically stable.
   */
  frameChildrenStart: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    constraints: NodeConstraints | undefined;
  }> | null;
}

export interface MeasureToolState {
  /** Node id recorded on pointerDown; the measurement's "from" endpoint. */
  fromId: string | null;
  /** True between pointerDown-on-node and pointerUp while the measure tool is dragging. */
  isActive: boolean;
}

export interface InteractionContext {
  canvas: HTMLCanvasElement;
  screenToWorld: (x: number, y: number) => { x: number; y: number };
  isSpaceHeld: () => boolean;
}
