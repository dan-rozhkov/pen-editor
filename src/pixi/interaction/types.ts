export type HandleCorner = "tl" | "tr" | "bl" | "br";
export type HandleSide = "l" | "r" | "t" | "b";
export type TransformHandle = HandleCorner | HandleSide;

import type { SnapTarget } from "@/utils/smartGuideUtils";

export interface DragState {
  isDragging: boolean;
  nodeId: string | null;
  startWorldX: number;
  startWorldY: number;
  startNodeX: number;
  startNodeY: number;
  parentOffsetX: number;
  parentOffsetY: number;
  snapTargets: SnapTarget[];
  snapOffsetX: number;
  snapOffsetY: number;
  // Auto-layout drag reordering
  isAutoLayoutDrag: boolean;
  autoLayoutParentId: string | null;
}

export interface PanState {
  isPanning: boolean;
  startX: number;
  startY: number;
  startViewX: number;
  startViewY: number;
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
}

export interface InteractionContext {
  canvas: HTMLCanvasElement;
  screenToWorld: (x: number, y: number) => { x: number; y: number };
  isSpaceHeld: () => boolean;
}
