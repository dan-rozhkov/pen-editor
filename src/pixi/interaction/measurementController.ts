import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useMeasureStore } from "@/store/measureStore";
import { useLayoutStore } from "@/store/layoutStore";
import {
  findNodeById,
  getNodeAbsolutePositionWithLayout,
  getNodeEffectiveSize,
  isDescendantOf,
} from "@/utils/nodeUtils";
import {
  computeParentDistances,
  computeSiblingDistances,
} from "@/utils/measureUtils";
import type { InteractionContext } from "./types";

export interface MeasurementController {
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }, hitId: string | null): void;
}

export function createMeasurementController(_context: InteractionContext): MeasurementController {
  return {
    handlePointerMove(_e: PointerEvent, _world: { x: number; y: number }, hitId: string | null): void {
      // Measurement distance computation (Option/Alt + hover)
      const { modifierHeld, setLines, clearLines } = useMeasureStore.getState();
      if (!hitId || !modifierHeld) {
        clearLines();
      } else {
        const currentSelectedIds = useSelectionStore.getState().selectedIds;
        const selectedSet = new Set(currentSelectedIds);

        if (currentSelectedIds.length >= 1 && !selectedSet.has(hitId)) {
          const currentNodes = useSceneStore.getState().getNodes();
          const calculateLayoutForFrame =
            useLayoutStore.getState().calculateLayoutForFrame;

          // Compute combined bounding box of all selected nodes
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          let allValid = true;
          for (const selId of currentSelectedIds) {
            const node = findNodeById(currentNodes, selId);
            const pos = getNodeAbsolutePositionWithLayout(
              currentNodes, selId, calculateLayoutForFrame,
            );
            if (!node || !pos) { allValid = false; break; }
            const size = getNodeEffectiveSize(
              currentNodes, selId, calculateLayoutForFrame,
            );
            const w = size?.width ?? node.width;
            const h = size?.height ?? node.height;
            minX = Math.min(minX, pos.x);
            minY = Math.min(minY, pos.y);
            maxX = Math.max(maxX, pos.x + w);
            maxY = Math.max(maxY, pos.y + h);
          }

          const hoveredNode = findNodeById(currentNodes, hitId);
          const hoveredPos = getNodeAbsolutePositionWithLayout(
            currentNodes, hitId, calculateLayoutForFrame,
          );

          if (allValid && hoveredNode && hoveredPos) {
            const hoveredSize = getNodeEffectiveSize(
              currentNodes, hitId, calculateLayoutForFrame,
            );
            const selectedBounds = {
              x: minX,
              y: minY,
              width: maxX - minX,
              height: maxY - minY,
            };
            const hoveredBounds = {
              x: hoveredPos.x,
              y: hoveredPos.y,
              width: hoveredSize?.width ?? hoveredNode.width,
              height: hoveredSize?.height ?? hoveredNode.height,
            };

            // For single selection, check if hovered is a parent
            if (currentSelectedIds.length === 1) {
              const isParent = isDescendantOf(currentNodes, hitId, currentSelectedIds[0]);
              if (isParent) {
                setLines(computeParentDistances(selectedBounds, hoveredBounds));
              } else {
                setLines(computeSiblingDistances(selectedBounds, hoveredBounds));
              }
            } else {
              setLines(computeSiblingDistances(selectedBounds, hoveredBounds));
            }
          } else {
            clearLines();
          }
        } else {
          clearLines();
        }
      }
    },
  };
}
