import { useDrawModeStore } from "@/store/drawModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useViewportStore } from "@/store/viewportStore";
import { generateId } from "@/types/scene";
import type { PathNode } from "@/types/scene";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import { buildTextPathNodeFromPath, findClosestPathNode } from "./textPathHitTest";
import type { InteractionContext } from "./types";

/** Screen-space hover/click threshold, converted to world units by the current zoom (mirrors `pathEditGeometry.ts`'s HIT_RADIUS_PX). */
const HOVER_THRESHOLD_PX = 10;

export interface TextPathController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
}

/**
 * The "text on a path" tool: hover a vector path, click to convert it into a
 * text-on-path node in place (fill/effects migrate onto the new text layer;
 * the source path node is removed — see `textPathHitTest.ts`'s
 * `buildTextPathNodeFromPath`). Modeled after `penController.ts`'s
 * single-tool-gated shape.
 */
export function createTextPathController(_context: InteractionContext): TextPathController {
  function getAbsPos(id: string): { x: number; y: number } | null {
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    return getNodeAbsolutePositionWithLayout(useSceneStore.getState().getNodes(), id, calculateLayoutForFrame);
  }

  function findHover(world: { x: number; y: number }): string | null {
    const scale = useViewportStore.getState().scale || 1;
    const threshold = HOVER_THRESHOLD_PX / scale;
    const nodesById = useSceneStore.getState().nodesById;
    return findClosestPathNode(world.x, world.y, nodesById, getAbsPos, threshold)?.nodeId ?? null;
  }

  return {
    handlePointerDown(e, world) {
      const { activeTool } = useDrawModeStore.getState();
      if (activeTool !== "text-path" || e.button !== 0) return false;

      const hoverId = findHover(world);
      // Swallow the click regardless of hit so the tool doesn't fall through
      // to normal selection/marquee while active — matches penController's
      // "gate on activeTool, consume every click while active" shape.
      if (!hoverId) return true;

      const state = useSceneStore.getState();
      const pathNode = state.nodesById[hoverId];
      if (!pathNode || pathNode.type !== "path") return true;

      const newId = generateId();
      const textNode = buildTextPathNodeFromPath(pathNode as unknown as PathNode, newId);
      const parentId = state.parentById[hoverId] ?? null;

      state.deleteNode(hoverId);
      if (parentId) {
        useSceneStore.getState().addChildToFrame(parentId, textNode);
      } else {
        useSceneStore.getState().addNode(textNode);
      }

      useSelectionStore.getState().select(newId);
      useDrawModeStore.getState().setActiveTool(null);
      return true;
    },

    handlePointerMove(_e, _world) {
      // No dedicated hover highlight yet — findHover (used by the click
      // handler above) is the single source of truth for "which path would
      // a click hit"; a canvas highlight/cursor-on-path affordance reusing
      // it is a follow-up (see the task report). The shared hover pass
      // already shows a generic crosshair cursor for any non-cursor/scale
      // tool, so this is a no-op that just declines to handle the move.
      return false;
    },
  };
}
