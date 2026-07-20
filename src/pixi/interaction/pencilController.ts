import { useDrawModeStore } from "@/store/drawModeStore";
import type { SceneNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import { pointsToSmoothSVGPath } from "@/utils/pathSmoothing";
import { getPathBBox } from "@/utils/svgUtils";
import { addDrawnNodeWithAutoParenting } from "./autoParentPlacement";
import type { InteractionContext, PointerGestureHandlers } from "./types";

export interface PencilController extends PointerGestureHandlers {
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

      const { pencilSettings } = useDrawModeStore.getState();

      // Map smoothing 0-100 to epsilon 0.5-5.0
      const epsilon = 0.5 + (pencilSettings.smoothing / 100) * 4.5;

      // Generate smooth SVG path
      void epsilon;
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
        opacity: pencilSettings.opacity,
        geometry: svgPath,
        geometryBounds: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
        pathStroke: {
          fill: pencilSettings.color,
          thickness: pencilSettings.thickness,
          join: "round",
          cap: pencilSettings.cap,
          align: "center",
        },
      };

      addDrawnNodeWithAutoParenting(node, bbox, id);
      useDrawModeStore.getState().endDrawing();
      return true;
    },

    isDrawing: () => drawing,
  };
}
