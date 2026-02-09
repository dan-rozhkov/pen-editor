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
        if (currentSelectedIds.length === 1) {
          const selectedId = currentSelectedIds[0];
          if (selectedId !== hitId) {
            const currentNodes = useSceneStore.getState().getNodes();
            const calculateLayoutForFrame =
              useLayoutStore.getState().calculateLayoutForFrame;
            const selectedNode = findNodeById(currentNodes, selectedId);
            const hoveredNode = findNodeById(currentNodes, hitId);
            const selectedPos = getNodeAbsolutePositionWithLayout(
              currentNodes,
              selectedId,
              calculateLayoutForFrame,
            );
            const hoveredPos = getNodeAbsolutePositionWithLayout(
              currentNodes,
              hitId,
              calculateLayoutForFrame,
            );
            if (selectedNode && hoveredNode && selectedPos && hoveredPos) {
              const selectedSize = getNodeEffectiveSize(
                currentNodes,
                selectedId,
                calculateLayoutForFrame,
              );
              const hoveredSize = getNodeEffectiveSize(
                currentNodes,
                hitId,
                calculateLayoutForFrame,
              );
              const selectedBounds = {
                x: selectedPos.x,
                y: selectedPos.y,
                width: selectedSize?.width ?? selectedNode.width,
                height: selectedSize?.height ?? selectedNode.height,
              };
              const hoveredBounds = {
                x: hoveredPos.x,
                y: hoveredPos.y,
                width: hoveredSize?.width ?? hoveredNode.width,
                height: hoveredSize?.height ?? hoveredNode.height,
              };
              const isParent = isDescendantOf(currentNodes, hitId, selectedId);
              if (isParent) {
                setLines(computeParentDistances(selectedBounds, hoveredBounds));
              } else {
                setLines(computeSiblingDistances(selectedBounds, hoveredBounds));
              }
            } else {
              clearLines();
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
