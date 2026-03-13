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
import { findResolvedDescendantByPath } from "@/utils/instanceRuntime";
import type { RefNode } from "@/types/scene";
import type { InteractionContext } from "./types";

export interface MeasurementController {
  handlePointerMove(
    e: PointerEvent,
    world: { x: number; y: number },
    hitId: string | null,
    hoveredDescendant?: { instanceId: string; descendantPath: string },
  ): void;
}

function resolveDescendantBounds(
  instanceId: string,
  descendantPath: string,
): { x: number; y: number; width: number; height: number } | null {
  const { nodesById, childrenById, parentById } = useSceneStore.getState();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const refNode = nodesById[instanceId];
  if (!refNode || refNode.type !== "ref") return null;
  const resolved = findResolvedDescendantByPath(
    refNode as RefNode,
    descendantPath,
    nodesById,
    childrenById,
    parentById,
    calculateLayoutForFrame,
  );
  if (!resolved) return null;
  return { x: resolved.absX, y: resolved.absY, width: resolved.width, height: resolved.height };
}

export function createMeasurementController(_context: InteractionContext): MeasurementController {
  return {
    handlePointerMove(
      _e: PointerEvent,
      _world: { x: number; y: number },
      hitId: string | null,
      hoveredDescendant?: { instanceId: string; descendantPath: string },
    ): void {
      // Measurement distance computation (Option/Alt + hover)
      const { modifierHeld, setLines, clearLines } = useMeasureStore.getState();
      if (!hitId || !modifierHeld) {
        clearLines();
      } else {
        const selState = useSelectionStore.getState();
        const currentSelectedIds = selState.selectedIds;
        const selectedSet = new Set(currentSelectedIds);

        // Allow measurement when hovering a different descendant of the same instance
        const instCtx = selState.instanceContext;
        const isHoveringSameInstance = instCtx && hoveredDescendant &&
          hitId === instCtx.instanceId && hoveredDescendant.descendantPath !== instCtx.descendantPath;
        if (currentSelectedIds.length >= 1 && (!selectedSet.has(hitId) || isHoveringSameInstance)) {
          const currentNodes = useSceneStore.getState().getNodes();
          const calculateLayoutForFrame =
            useLayoutStore.getState().calculateLayoutForFrame;

          // Compute combined bounding box of all selected nodes
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          let allValid = true;

          if (instCtx) {
            // Selected node is an instance descendant — resolve its bounds
            const bounds = resolveDescendantBounds(instCtx.instanceId, instCtx.descendantPath);
            if (!bounds) { allValid = false; } else {
              minX = bounds.x;
              minY = bounds.y;
              maxX = bounds.x + bounds.width;
              maxY = bounds.y + bounds.height;
            }
          } else {
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
          }

          // Resolve hovered node bounds
          let hoveredBounds: { x: number; y: number; width: number; height: number } | null = null;

          if (hoveredDescendant) {
            // Hovered node is an instance descendant
            hoveredBounds = resolveDescendantBounds(hoveredDescendant.instanceId, hoveredDescendant.descendantPath);
          } else {
            const hoveredNode = findNodeById(currentNodes, hitId);
            const hoveredPos = getNodeAbsolutePositionWithLayout(
              currentNodes, hitId, calculateLayoutForFrame,
            );
            if (hoveredNode && hoveredPos) {
              const hoveredSize = getNodeEffectiveSize(
                currentNodes, hitId, calculateLayoutForFrame,
              );
              hoveredBounds = {
                x: hoveredPos.x,
                y: hoveredPos.y,
                width: hoveredSize?.width ?? hoveredNode.width,
                height: hoveredSize?.height ?? hoveredNode.height,
              };
            }
          }

          if (allValid && hoveredBounds) {
            const selectedBounds = {
              x: minX,
              y: minY,
              width: maxX - minX,
              height: maxY - minY,
            };

            // For single selection, check if hovered is a parent
            if (currentSelectedIds.length === 1 && !instCtx) {
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
