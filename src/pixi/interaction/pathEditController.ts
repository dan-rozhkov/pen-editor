import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { usePenToolStore } from "@/store/penToolStore";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import { moveAnchorPoint, moveHandlePoint, type PathAnchor } from "@/utils/pathAnchors";
import {
  getEditedAnchorTarget,
  hitTestPathEdit,
  worldDeltaToAnchorDelta,
  type AnchorEditTarget,
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
  target: AnchorEditTarget;
  startWorld: { x: number; y: number };
  historySaved: boolean;
}

export function createPathEditController(context: InteractionContext): PathEditController {
  let drag: DragState | null = null;

  function isActive(): boolean {
    const mode = useSelectionStore.getState().editingMode;
    return mode === "path" || mode === "text-path";
  }

  return {
    isActive,
    isDragging: () => drag !== null,

    handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean {
      if (!isActive() || e.button !== 0) return false;
      const target = getEditedAnchorTarget();
      if (!target) return false;

      const hit = hitTestPathEdit(world.x, world.y);
      if (!hit) return false;

      drag = {
        hit,
        target,
        startWorld: world,
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

      const { dx, dy } = worldDeltaToAnchorDelta(drag.target.scaleBasis, rawDx, rawDy);
      const originalPoints = drag.target.points;

      let nextPoints: PathAnchor[];
      if (drag.hit.kind === "anchor") {
        nextPoints = moveAnchorPoint(originalPoints, drag.hit.index, dx, dy);
      } else {
        const original = originalPoints[drag.hit.index];
        const originalHandle = drag.hit.which === "out" ? original?.handleOut : original?.handleIn;
        const basePos = originalHandle ?? original ?? { x: 0, y: 0 };
        nextPoints = moveHandlePoint(
          originalPoints,
          drag.hit.index,
          drag.hit.which,
          { x: basePos.x + dx, y: basePos.y + dy },
          e.altKey,
        );
      }

      useSceneStore.getState().updateNodeWithoutHistory(
        drag.target.id,
        drag.target.applyEdit(nextPoints, drag.target.closed),
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
