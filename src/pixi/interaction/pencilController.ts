import { useSceneStore } from "@/store/sceneStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useLayoutStore } from "@/store/layoutStore";
import type { SceneNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import { findTopmostFrameContainingRectWithLayout } from "@/utils/nodeUtils";
import { pointsToSmoothSVGPath } from "@/utils/pathSmoothing";
import { getPathBBox } from "@/utils/svgUtils";
import type { InteractionContext } from "./types";

export interface PencilController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerUp(e: PointerEvent, world: { x: number; y: number }): boolean;
  isDrawing: () => boolean;
}

export function createPencilController(_context: InteractionContext): PencilController {
  let drawing = false;
  let rawPoints: { x: number; y: number }[] = [];

  return {
    handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean {
      const { activeTool } = useDrawModeStore.getState();
      if (activeTool !== "pencil" || e.button !== 0) return false;

      drawing = true;
      rawPoints = [{ x: world.x, y: world.y }];
      useDrawModeStore.getState().startDrawing({ x: world.x, y: world.y });
      useDrawModeStore.getState().addPencilPoint({ x: world.x, y: world.y });
      return true;
    },

    handlePointerMove(_e: PointerEvent, world: { x: number; y: number }): boolean {
      if (!drawing) return false;

      rawPoints.push({ x: world.x, y: world.y });
      useDrawModeStore.getState().updateDrawing({ x: world.x, y: world.y });
      useDrawModeStore.getState().addPencilPoint({ x: world.x, y: world.y });
      return true;
    },

    handlePointerUp(_e: PointerEvent, _world: { x: number; y: number }): boolean {
      if (!drawing) return false;

      drawing = false;

      if (rawPoints.length < 2) {
        useDrawModeStore.getState().endDrawing();
        return true;
      }

      // Generate smooth SVG path
      const svgPath = pointsToSmoothSVGPath(rawPoints);
      const bbox = getPathBBox(svgPath);

      if (bbox.width < 1 && bbox.height < 1) {
        useDrawModeStore.getState().endDrawing();
        return true;
      }

      const id = generateId();
      const node: SceneNode = {
        id,
        type: "path",
        name: "Pencil",
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
        geometry: svgPath,
        geometryBounds: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
        pathStroke: {
          fill: "#000000",
          thickness: 2,
          join: "round",
          cap: "round",
          align: "center",
        },
      };

      // Auto-parent into frames
      const sceneState = useSceneStore.getState();
      const currentNodes = sceneState.getNodes();
      const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
      const targetRect = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
      const targetFrame = findTopmostFrameContainingRectWithLayout(
        currentNodes,
        targetRect,
        calculateLayoutForFrame,
      );

      if (targetFrame) {
        sceneState.addChildToFrame(targetFrame.frame.id, {
          ...node,
          x: bbox.x - targetFrame.absoluteX,
          y: bbox.y - targetFrame.absoluteY,
        });
      } else {
        sceneState.addNode(node);
      }

      useSelectionStore.getState().select(id);
      useDrawModeStore.getState().endDrawing();
      return true;
    },

    isDrawing: () => drawing,
  };
}
