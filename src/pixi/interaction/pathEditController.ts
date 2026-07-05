import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { usePenToolStore } from "@/store/penToolStore";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import { applyAnchorEditToNode, moveAnchorPoint, moveHandlePoint, type PathAnchor } from "@/utils/pathAnchors";
import type { PathNode } from "@/types/scene";
import {
  getEditedPathNode,
  hitTestPathEdit,
  worldDeltaToAnchorDelta,
  type PathEditHit,
} from "./pathEditGeometry";
import type { InteractionContext } from "./types";

export interface PathEditController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerUp(e: PointerEvent, world: { x: number; y: number }): boolean;
  isActive: () => boolean;
  isDragging: () => boolean;
}

interface DragState {
  hit: PathEditHit;
  nodeId: string;
  startWorld: { x: number; y: number };
  originalPoints: PathAnchor[];
  originalClosed: boolean;
  originalNode: Pick<PathNode, "x" | "y" | "width" | "height" | "geometryBounds">;
  historySaved: boolean;
}

export function createPathEditController(context: InteractionContext): PathEditController {
  let drag: DragState | null = null;

  function isActive(): boolean {
    return useSelectionStore.getState().editingMode === "path";
  }

  return {
    isActive,
    isDragging: () => drag !== null,

    handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean {
      if (!isActive() || e.button !== 0) return false;
      const edited = getEditedPathNode();
      if (!edited) return false;

      const hit = hitTestPathEdit(world.x, world.y);
      if (!hit) return false;

      drag = {
        hit,
        nodeId: edited.id,
        startWorld: world,
        originalPoints: edited.node.points ?? [],
        originalClosed: edited.node.closed ?? false,
        originalNode: {
          x: edited.node.x,
          y: edited.node.y,
          width: edited.node.width,
          height: edited.node.height,
          geometryBounds: edited.node.geometryBounds,
        },
        historySaved: false,
      };
      context.canvas.style.cursor = "grabbing";
      return true;
    },

    handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean {
      if (!drag) {
        // Hover highlight (for cursor + overlay) only, while in edit mode.
        if (isActive()) {
          const hit = hitTestPathEdit(world.x, world.y);
          const pen = usePenToolStore.getState();
          pen.setHoveredAnchor(hit?.kind === "anchor" ? hit.index : null);
          pen.setHoveredHandle(hit?.kind === "handle" ? { anchorIndex: hit.index, which: hit.which } : null);
          context.canvas.style.cursor = hit ? "pointer" : "default";
        }
        return false;
      }

      const rawDx = world.x - drag.startWorld.x;
      const rawDy = world.y - drag.startWorld.y;
      if (rawDx === 0 && rawDy === 0) return true;

      if (!drag.historySaved) {
        saveHistory(useSceneStore.getState());
        drag.historySaved = true;
      }

      const { dx, dy } = worldDeltaToAnchorDelta(drag.originalNode, rawDx, rawDy);

      let nextPoints: PathAnchor[];
      if (drag.hit.kind === "anchor") {
        nextPoints = moveAnchorPoint(drag.originalPoints, drag.hit.index, dx, dy);
      } else {
        const original = drag.originalPoints[drag.hit.index];
        const originalHandle = drag.hit.which === "out" ? original?.handleOut : original?.handleIn;
        const basePos = originalHandle ?? original ?? { x: 0, y: 0 };
        nextPoints = moveHandlePoint(
          drag.originalPoints,
          drag.hit.index,
          drag.hit.which,
          { x: basePos.x + dx, y: basePos.y + dy },
          e.altKey,
        );
      }

      useSceneStore.getState().updateNodeWithoutHistory(
        drag.nodeId,
        applyAnchorEditToNode(drag.originalNode, nextPoints, drag.originalClosed),
      );
      return true;
    },

    handlePointerUp(_e: PointerEvent, _world: { x: number; y: number }): boolean {
      if (!drag) return false;
      drag = null;
      context.canvas.style.cursor = "default";
      return true;
    },
  };
}
