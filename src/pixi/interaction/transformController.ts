import { useSceneStore } from "@/store/sceneStore";
import type { InteractionContext, TransformState } from "./types";
import { hitTestTransformHandle, getResizeCursor } from "./hitTesting";
import { generatePolygonPoints } from "@/utils/polygonUtils";
import type { PolygonNode, LineNode } from "@/types/scene";

export interface TransformController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerUp(e: PointerEvent, world: { x: number; y: number }): boolean;
  isTransforming: () => boolean;
}

export function createTransformController(context: InteractionContext): TransformController {
  const state: TransformState = {
    isTransforming: false,
    nodeId: null,
    corner: null,
    startNodeX: 0,
    startNodeY: 0,
    startNodeW: 0,
    startNodeH: 0,
    absX: 0,
    absY: 0,
    parentOffsetX: 0,
    parentOffsetY: 0,
    startLinePoints: null,
  };

  return {
    handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean {
      if (e.button === 0) {
        const handleHit = hitTestTransformHandle(world.x, world.y);
        if (handleHit) {
          const sceneState = useSceneStore.getState();
          const node = sceneState.nodesById[handleHit.nodeId];
          if (node) {
            state.isTransforming = true;
            state.nodeId = handleHit.nodeId;
            state.corner = handleHit.corner;
            state.startNodeX = node.x;
            state.startNodeY = node.y;
            state.startNodeW = handleHit.width;
            state.startNodeH = handleHit.height;
            state.absX = handleHit.absX;
            state.absY = handleHit.absY;
            state.parentOffsetX = handleHit.absX - node.x;
            state.parentOffsetY = handleHit.absY - node.y;
            state.startLinePoints = node.type === "line" ? [...(node as LineNode).points] : null;
            context.canvas.style.cursor = getResizeCursor(handleHit.corner);
            return true;
          }
        }
      }
      return false;
    },

    handlePointerMove(_e: PointerEvent, world: { x: number; y: number }): boolean {
      if (state.isTransforming && state.nodeId && state.corner) {
        const MIN_SIZE = 5;
        const corner = state.corner;
        const absWorldX = world.x;
        const absWorldY = world.y;

        let newX = state.startNodeX;
        let newY = state.startNodeY;
        let newW = state.startNodeW;
        let newH = state.startNodeH;

        // Compute bounding box edges in absolute coordinates
        const origLeft = state.absX;
        const origTop = state.absY;
        const origRight = origLeft + state.startNodeW;
        const origBottom = origTop + state.startNodeH;

        if (corner === "br") {
          newW = Math.max(MIN_SIZE, absWorldX - origLeft);
          newH = Math.max(MIN_SIZE, absWorldY - origTop);
        } else if (corner === "bl") {
          const newRight = origRight;
          const newLeft = Math.min(absWorldX, newRight - MIN_SIZE);
          newW = newRight - newLeft;
          newX = state.startNodeX + (newLeft - origLeft);
          newH = Math.max(MIN_SIZE, absWorldY - origTop);
        } else if (corner === "tr") {
          newW = Math.max(MIN_SIZE, absWorldX - origLeft);
          const newBottom = origBottom;
          const newTop = Math.min(absWorldY, newBottom - MIN_SIZE);
          newH = newBottom - newTop;
          newY = state.startNodeY + (newTop - origTop);
        } else if (corner === "tl") {
          const newRight = origRight;
          const newBottom = origBottom;
          const newLeft = Math.min(absWorldX, newRight - MIN_SIZE);
          const newTop = Math.min(absWorldY, newBottom - MIN_SIZE);
          newW = newRight - newLeft;
          newH = newBottom - newTop;
          newX = state.startNodeX + (newLeft - origLeft);
          newY = state.startNodeY + (newTop - origTop);
        } else if (corner === "r") {
          newW = Math.max(MIN_SIZE, absWorldX - origLeft);
        } else if (corner === "l") {
          const newRight = origRight;
          const newLeft = Math.min(absWorldX, newRight - MIN_SIZE);
          newW = newRight - newLeft;
          newX = state.startNodeX + (newLeft - origLeft);
        } else if (corner === "b") {
          newH = Math.max(MIN_SIZE, absWorldY - origTop);
        } else if (corner === "t") {
          const newBottom = origBottom;
          const newTop = Math.min(absWorldY, newBottom - MIN_SIZE);
          newH = newBottom - newTop;
          newY = state.startNodeY + (newTop - origTop);
        }

        const roundedW = Math.round(newW);
        const roundedH = Math.round(newH);
        const updates: Record<string, unknown> = {
          x: Math.round(newX),
          y: Math.round(newY),
          width: roundedW,
          height: roundedH,
        };

        // Regenerate points for polygon/line nodes
        const node = useSceneStore.getState().nodesById[state.nodeId];
        if (node?.type === "polygon") {
          const sides = (node as PolygonNode).sides ?? 6;
          updates.points = generatePolygonPoints(sides, roundedW, roundedH);
        } else if (node?.type === "line" && state.startLinePoints) {
          const scaleFactorX = roundedW / state.startNodeW;
          const scaleFactorY = roundedH / state.startNodeH;
          updates.points = state.startLinePoints.map((v, i) =>
            i % 2 === 0 ? v * scaleFactorX : v * scaleFactorY,
          );
        }

        useSceneStore.getState().updateNodeWithoutHistory(state.nodeId, updates);
        return true;
      }
      return false;
    },

    handlePointerUp(_e: PointerEvent, _world: { x: number; y: number }): boolean {
      if (state.isTransforming && state.nodeId) {
        const sceneState = useSceneStore.getState();
        const node = sceneState.nodesById[state.nodeId];
        if (node) {
          // Commit the resize with history
          const commitUpdates: Record<string, unknown> = {
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
          };
          if (node.type === "polygon") {
            commitUpdates.points = (node as PolygonNode).points;
          } else if (node.type === "line") {
            commitUpdates.points = (node as LineNode).points;
          }
          useSceneStore.getState().updateNode(state.nodeId, commitUpdates);
        }
        state.isTransforming = false;
        state.nodeId = null;
        state.corner = null;
        context.canvas.style.cursor = "";
        return true;
      }
      return false;
    },

    isTransforming: () => state.isTransforming,
  };
}
