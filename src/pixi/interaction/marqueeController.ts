import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { setMarqueeRect } from "../pixiOverlayState";
import type { InteractionContext, MarqueeState } from "./types";

export interface MarqueeController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }, hitId: string | null): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerUp(e: PointerEvent, world: { x: number; y: number }): boolean;
  isActive: () => boolean;
}

export function createMarqueeController(_context: InteractionContext): MarqueeController {
  const state: MarqueeState = {
    isActive: false,
    startWorldX: 0,
    startWorldY: 0,
    shiftHeld: false,
    preShiftIds: [],
  };

  return {
    handlePointerDown(e: PointerEvent, world: { x: number; y: number }, hitId: string | null): boolean {
      if (e.button === 0 && !hitId) {
        // Click on background
        useSelectionStore.getState().resetContainerContext();
        state.shiftHeld = e.shiftKey;
        state.preShiftIds = e.shiftKey
          ? useSelectionStore.getState().selectedIds.slice()
          : [];
        if (!e.shiftKey) {
          useSelectionStore.getState().clearSelection();
        }

        // Start marquee selection
        state.isActive = true;
        state.startWorldX = world.x;
        state.startWorldY = world.y;
        return true;
      }
      return false;
    },

    handlePointerMove(_e: PointerEvent, world: { x: number; y: number }): boolean {
      if (state.isActive) {
        const x = Math.min(state.startWorldX, world.x);
        const y = Math.min(state.startWorldY, world.y);
        const w = Math.abs(world.x - state.startWorldX);
        const h = Math.abs(world.y - state.startWorldY);
        setMarqueeRect({ x, y, width: w, height: h });
        return true;
      }
      return false;
    },

    handlePointerUp(_e: PointerEvent, world: { x: number; y: number }): boolean {
      if (state.isActive) {
        state.isActive = false;
        setMarqueeRect(null);

        const x1 = Math.min(state.startWorldX, world.x);
        const y1 = Math.min(state.startWorldY, world.y);
        const x2 = Math.max(state.startWorldX, world.x);
        const y2 = Math.max(state.startWorldY, world.y);

        // Find all nodes intersecting the marquee
        if (Math.abs(x2 - x1) > 2 || Math.abs(y2 - y1) > 2) {
          const sceneState = useSceneStore.getState();
          const ids: string[] = [];
          for (const rootId of sceneState.rootIds) {
            const node = sceneState.nodesById[rootId];
            if (!node || node.visible === false || node.enabled === false) continue;
            const nodeRight = node.x + node.width;
            const nodeBottom = node.y + node.height;
            if (node.x < x2 && nodeRight > x1 && node.y < y2 && nodeBottom > y1) {
              ids.push(rootId);
            }
          }
          if (state.shiftHeld) {
            const merged = [...new Set([...state.preShiftIds, ...ids])];
            useSelectionStore.getState().setSelectedIds(merged);
          } else if (ids.length > 0) {
            useSelectionStore.getState().setSelectedIds(ids);
          }
        }

        state.shiftHeld = false;
        state.preShiftIds = [];
        return true;
      }
      return false;
    },

    isActive: () => state.isActive,
  };
}
