import { useSceneStore } from "@/store/sceneStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useLayoutStore } from "@/store/layoutStore";
import type { SceneNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import {
  findTopmostFrameContainedByRectWithLayout,
  findTopmostFrameContainingRectWithLayout,
} from "@/utils/nodeUtils";
import { generatePolygonPoints } from "@/utils/polygonUtils";
import type { InteractionContext, DrawState } from "./types";

export interface DrawController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerUp(e: PointerEvent, world: { x: number; y: number }): boolean;
  isDrawing: () => boolean;
}

export function createDrawController(_context: InteractionContext): DrawController {
  const state: DrawState = {
    isDrawing: false,
    startWorldX: 0,
    startWorldY: 0,
  };

  function createDrawnNode(
    tool: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const id = generateId();
    let node: SceneNode;

    switch (tool) {
      case "frame":
        node = {
          id,
          type: "frame",
          x,
          y,
          width,
          height,
          fill: "#ffffff",
          stroke: "#cccccc",
          strokeWidth: 1,
          children: [],
        };
        break;
      case "rect":
        node = { id, type: "rect", x, y, width, height, fill: "#cccccc" };
        break;
      case "ellipse":
        node = { id, type: "ellipse", x, y, width, height, fill: "#cccccc" };
        break;
      case "text":
        node = {
          id,
          type: "text",
          x,
          y,
          width,
          height,
          text: "Text",
          fontSize: 14,
          fill: "#000000",
        };
        break;
      case "line":
        node = {
          id,
          type: "line",
          x,
          y,
          width,
          height,
          stroke: "#000000",
          strokeWidth: 2,
          points: [0, 0, width, height],
        };
        break;
      case "polygon": {
        const sides = 6;
        const points = generatePolygonPoints(sides, width, height);
        node = {
          id,
          type: "polygon",
          x,
          y,
          width,
          height,
          fill: "#50b87d",
          sides,
          points,
        };
        break;
      }
      default:
        return;
    }

    const sceneState = useSceneStore.getState();
    const currentNodes = sceneState.getNodes();
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const targetRect = { x, y, width, height };
    const targetFrame = findTopmostFrameContainingRectWithLayout(
      currentNodes,
      targetRect,
      calculateLayoutForFrame,
    );

    if (targetFrame) {
      sceneState.addChildToFrame(targetFrame.frame.id, {
        ...node,
        x: x - targetFrame.absoluteX,
        y: y - targetFrame.absoluteY,
      });
    } else {
      sceneState.addNode(node);
      if (tool === "frame") {
        const wrappedFrame = findTopmostFrameContainedByRectWithLayout(
          currentNodes,
          targetRect,
          calculateLayoutForFrame,
        );
        if (wrappedFrame && wrappedFrame.frame.id !== id) {
          sceneState.updateNodeWithoutHistory(wrappedFrame.frame.id, {
            x: wrappedFrame.absoluteX - x,
            y: wrappedFrame.absoluteY - y,
          });
          sceneState.moveNode(wrappedFrame.frame.id, id, 0);
        }
      }
    }
    useSelectionStore.getState().select(id);
  }

  return {
    handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean {
      const { activeTool } = useDrawModeStore.getState();
      if (activeTool && activeTool !== "cursor" && e.button === 0) {
        state.isDrawing = true;
        state.startWorldX = world.x;
        state.startWorldY = world.y;
        useDrawModeStore.getState().startDrawing({ x: world.x, y: world.y });
        return true;
      }
      return false;
    },

    handlePointerMove(_e: PointerEvent, world: { x: number; y: number }): boolean {
      if (state.isDrawing) {
        useDrawModeStore.getState().updateDrawing({ x: world.x, y: world.y });
        return true;
      }
      return false;
    },

    handlePointerUp(_e: PointerEvent, world: { x: number; y: number }): boolean {
      if (state.isDrawing) {
        state.isDrawing = false;
        const { activeTool } = useDrawModeStore.getState();
        if (activeTool) {
          const x = Math.min(state.startWorldX, world.x);
          const y = Math.min(state.startWorldY, world.y);
          const width = Math.max(Math.abs(world.x - state.startWorldX), 10);
          const height = Math.max(Math.abs(world.y - state.startWorldY), 10);

          createDrawnNode(activeTool, x, y, width, height);
        }
        useDrawModeStore.getState().endDrawing();
        return true;
      }
      return false;
    },

    isDrawing: () => state.isDrawing,
  };
}
