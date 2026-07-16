import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useCommentsStore } from "@/store/commentsStore";
import {
  getNodeAbsolutePositionWithLayout,
  getNodeEffectiveSize,
} from "@/utils/nodeUtils";
import { buildClickAnchor } from "@/lib/comments/commentsLogic";
import { findCanvasHitTargetAtPoint } from "./hitTesting";
import type { InteractionContext } from "./types";

export interface CommentToolRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type HitTestFn = (worldX: number, worldY: number) => string | null;
type GetRectFn = (nodeId: string) => CommentToolRect | null;

export interface CommentToolControllerOverrides {
  hitTest?: HitTestFn;
  getRect?: GetRectFn;
}

export interface CommentToolController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean;
}

function defaultHitTest(worldX: number, worldY: number): string | null {
  const target = findCanvasHitTargetAtPoint(worldX, worldY, { deepSelect: true });
  return target?.kind === "node" ? target.nodeId : null;
}

function defaultGetRect(nodeId: string): CommentToolRect | null {
  const state = useSceneStore.getState();
  const node = state.nodesById[nodeId];
  if (!node) return null;
  const nodes = state.getNodes();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const pos = getNodeAbsolutePositionWithLayout(nodes, nodeId, calculateLayoutForFrame);
  if (!pos) return null;
  const size = getNodeEffectiveSize(nodes, nodeId, calculateLayoutForFrame);
  return {
    x: pos.x,
    y: pos.y,
    width: size?.width ?? node.width,
    height: size?.height ?? node.height,
  };
}

/**
 * Comment tool (C): a primary-button pointerDown places a pin. A click on a
 * node anchors to that node (ox/oy = fractional offset within its rect); a
 * click on empty canvas anchors to the world point. Placing a pin only opens
 * an in-progress *draft* (via `startDraft`) — the thread isn't created until
 * the user types a message and submits (CommentLayer composer). Returns true
 * whenever the comment tool is active so selection/drag never also fire
 * (mirrors measureToolController's gating). `hitTest`/`getRect` are injectable
 * for tests.
 */
export function createCommentToolController(
  _context: InteractionContext,
  overrides?: CommentToolControllerOverrides,
): CommentToolController {
  const hitTest = overrides?.hitTest ?? defaultHitTest;
  const getRect = overrides?.getRect ?? defaultGetRect;

  return {
    handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean {
      if (useDrawModeStore.getState().activeTool !== "comment" || e.button !== 0) {
        return false;
      }

      const nodeId = hitTest(world.x, world.y);
      const rect = nodeId ? getRect(nodeId) : null;
      const anchor = buildClickAnchor(
        world.x,
        world.y,
        nodeId && rect ? { nodeId, rect } : null,
      );
      useCommentsStore.getState().startDraft(anchor);
      return true;
    },
  };
}
