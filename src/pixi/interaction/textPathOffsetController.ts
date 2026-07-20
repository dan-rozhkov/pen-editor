import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useViewportStore } from "@/store/viewportStore";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import type { SceneNode, TextNode } from "@/types/scene";
import {
  getStartOffsetHandleWorldPos,
  hitTestStartOffsetHandle,
  offsetFromWorldPoint,
} from "./textPathOffsetGeometry";
import type { InteractionContext, PointerGestureHandlers } from "./types";

/** Screen-space hit radius for the handle, converted to world units by zoom (mirrors `pathEditGeometry.ts`'s `HIT_RADIUS_PX`). */
const HANDLE_HIT_RADIUS_PX = 8;

export interface TextPathOffsetController extends PointerGestureHandlers {
  isActive: () => boolean;
  isDragging: () => boolean;
}

interface DragState {
  nodeId: string;
  historySaved: boolean;
}

/**
 * The on-canvas `startOffset` drag handle for a text-on-path node (spec
 * section 4: "Синий хандл задаёт точку старта" — a blue handle draggable
 * along the curve). Modeled after `pathEditController.ts`'s shape (pure
 * geometry in a sibling module, lazy history-save-on-first-move, gate on an
 * `isActive()` predicate the interaction core checks before routing pointer
 * events here), but simpler: one point, no anchor/bezier-handle distinction.
 *
 * Active whenever the sole selection is a text node with `textPath` — no
 * separate "enter edit mode" step, matching the properties panel's Offset
 * field, which is likewise always available for such a node. This is
 * deliberately independent of `pathEditController`'s anchor-edit mode
 * (`editingMode === "text-path"`, entered via the panel's "Edit Path"
 * button): the two touch different, non-overlapping node fields
 * (`textPath.startOffset` vs `textPath.points`), and gating the handle
 * behind an explicit mode would regress the always-available panel control's
 * parity on canvas.
 */
export function createTextPathOffsetController(context: InteractionContext): TextPathOffsetController {
  let drag: DragState | null = null;

  function getSoleSelectedTextPathNode(): { id: string; node: TextNode } | null {
    const { selectedIds } = useSelectionStore.getState();
    if (selectedIds.length !== 1) return null;
    const node = useSceneStore.getState().nodesById[selectedIds[0]];
    if (!node || node.type !== "text" || !node.textPath) return null;
    return { id: selectedIds[0], node: node as unknown as TextNode };
  }

  function isActive(): boolean {
    return getSoleSelectedTextPathNode() !== null;
  }

  function getAbsPos(id: string): { x: number; y: number } | null {
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    return getNodeAbsolutePositionWithLayout(useSceneStore.getState().getNodes(), id, calculateLayoutForFrame);
  }

  return {
    isActive,
    isDragging: () => drag !== null,

    handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean {
      if (e.button !== 0) return false;
      const target = getSoleSelectedTextPathNode();
      if (!target) return false;
      const absPos = getAbsPos(target.id);
      if (!absPos) return false;

      const scale = useViewportStore.getState().scale || 1;
      const radius = HANDLE_HIT_RADIUS_PX / scale;
      if (!hitTestStartOffsetHandle(target.node.textPath!, absPos, world.x, world.y, radius)) {
        return false;
      }

      drag = { nodeId: target.id, historySaved: false };
      context.canvas.style.cursor = "grabbing";
      return true;
    },

    handlePointerMove(_e: PointerEvent, world: { x: number; y: number }): boolean {
      if (!drag) {
        if (isActive()) {
          const target = getSoleSelectedTextPathNode();
          const absPos = target ? getAbsPos(target.id) : null;
          if (target && absPos) {
            const scale = useViewportStore.getState().scale || 1;
            const radius = HANDLE_HIT_RADIUS_PX / scale;
            const hit = hitTestStartOffsetHandle(target.node.textPath!, absPos, world.x, world.y, radius);
            context.canvas.style.cursor = hit ? "grab" : "";
          }
        }
        return false;
      }

      const state = useSceneStore.getState();
      const node = state.nodesById[drag.nodeId];
      if (!node || node.type !== "text" || !node.textPath) {
        drag = null;
        return false;
      }
      const absPos = getAbsPos(drag.nodeId);
      if (!absPos) return true;

      const nextOffset = offsetFromWorldPoint(node.textPath, absPos, world.x, world.y);
      if (nextOffset === (node.textPath.startOffset ?? 0)) return true;

      if (!drag.historySaved) {
        saveHistory(useSceneStore.getState());
        drag.historySaved = true;
      }

      useSceneStore.getState().updateNodeWithoutHistory(drag.nodeId, {
        textPath: { ...node.textPath, startOffset: nextOffset },
      } as Partial<SceneNode>);
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

/** Current handle world position for the sole selected text-on-path node, or null — used by the overlay renderer. */
export function getActiveStartOffsetHandlePos(): { x: number; y: number } | null {
  const { selectedIds } = useSelectionStore.getState();
  if (selectedIds.length !== 1) return null;
  const node = useSceneStore.getState().nodesById[selectedIds[0]];
  if (!node || node.type !== "text" || !node.textPath) return null;
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const absPos = getNodeAbsolutePositionWithLayout(useSceneStore.getState().getNodes(), selectedIds[0], calculateLayoutForFrame);
  if (!absPos) return null;
  return getStartOffsetHandleWorldPos(node.textPath, absPos);
}
