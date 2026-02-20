import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import { useDragStore } from "@/store/dragStore";
import { useLayoutStore } from "@/store/layoutStore";
import type { FlatFrameNode } from "@/types/scene";
import {
  collectSnapTargets,
  getSnapEdges,
  calculateSnap,
} from "@/utils/smartGuideUtils";
import { getNodeAbsolutePosition } from "@/utils/nodeUtils";
import {
  calculateDropPosition,
  isPointInsideRect,
  getFrameAbsoluteRectWithLayout,
} from "@/utils/dragUtils";
import type { InteractionContext, DragState } from "./types";
import { findFrameInTree } from "./hitTesting";

const AXIS_LOCK_THRESHOLD = 8; // pixels

export interface DragController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }, hitId: string | null): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerUp(e: PointerEvent, world: { x: number; y: number }): boolean;
  isDragging: () => boolean;
}

export function createDragController(_context: InteractionContext): DragController {
  const state: DragState = {
    isDragging: false,
    nodeId: null,
    startWorldX: 0,
    startWorldY: 0,
    startNodeX: 0,
    startNodeY: 0,
    parentOffsetX: 0,
    parentOffsetY: 0,
    snapTargets: [],
    snapOffsetX: 0,
    snapOffsetY: 0,
    isAutoLayoutDrag: false,
    autoLayoutParentId: null,
    isShiftHeld: false,
    axisLock: null,
    cumulativeDeltaX: 0,
    cumulativeDeltaY: 0,
  };

  return {
    handlePointerDown(e: PointerEvent, world: { x: number; y: number }, hitId: string | null): boolean {
      if (e.button === 0 && hitId) {
        const sceneState = useSceneStore.getState();
        const node = sceneState.nodesById[hitId];
        if (!node) return false;

        // Select
        if (e.shiftKey) {
          useSelectionStore.getState().addToSelection(hitId);
        } else {
          useSelectionStore.getState().select(hitId);
        }

        // Cmd/Ctrl are selection modifiers - prevent drag
        // Shift is axis-lock modifier - allow drag
        if (e.metaKey || e.ctrlKey) {
          return false;
        }

        state.isDragging = true;
        state.nodeId = hitId;
        state.startWorldX = world.x;
        state.startWorldY = world.y;
        state.startNodeX = node.x;
        state.startNodeY = node.y;
        state.snapOffsetX = 0;
        state.snapOffsetY = 0;
        state.isAutoLayoutDrag = false;
        state.autoLayoutParentId = null;
        state.isShiftHeld = e.shiftKey;
        state.axisLock = null;
        state.cumulativeDeltaX = 0;
        state.cumulativeDeltaY = 0;

        // Check if node is inside an auto-layout frame (skip for absolute-positioned nodes)
        const parentId = sceneState.parentById[hitId];
        if (parentId && !node.absolutePosition) {
          const parentNode = sceneState.nodesById[parentId];
          if (
            parentNode &&
            parentNode.type === "frame" &&
            (parentNode as FlatFrameNode).layout?.autoLayout
          ) {
            state.isAutoLayoutDrag = true;
            state.autoLayoutParentId = parentId;
            useDragStore.getState().startDrag(hitId);
          }
        }

        // Compute parent offset for absolute position
        const nodes = sceneState.getNodes();
        const absPos = getNodeAbsolutePosition(nodes, hitId);
        if (absPos) {
          state.parentOffsetX = absPos.x - node.x;
          state.parentOffsetY = absPos.y - node.y;
        } else {
          state.parentOffsetX = 0;
          state.parentOffsetY = 0;
        }

        // Collect snap targets (skip for auto-layout drags)
        if (!state.isAutoLayoutDrag) {
          const selectedIds = useSelectionStore.getState().selectedIds;
          const excludeIds = new Set(selectedIds);
          state.snapTargets = collectSnapTargets(nodes, excludeIds);
        } else {
          state.snapTargets = [];
        }
        return true;
      }
      return false;
    },

    handlePointerMove(_e: PointerEvent, world: { x: number; y: number }): boolean {
      // Auto-layout drag reordering
      if (state.isDragging && state.nodeId && state.isAutoLayoutDrag && state.autoLayoutParentId) {
        const sceneState = useSceneStore.getState();
        const nodes = sceneState.getNodes();
        const parentFrame = findFrameInTree(nodes, state.autoLayoutParentId);
        if (parentFrame) {
          const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
          const frameRect = getFrameAbsoluteRectWithLayout(parentFrame, nodes, calculateLayoutForFrame);
          const cursorInParent = isPointInsideRect(world, frameRect);

          if (cursorInParent) {
            const layoutChildren = calculateLayoutForFrame(parentFrame);
            const dropResult = calculateDropPosition(
              world,
              parentFrame,
              { x: frameRect.x, y: frameRect.y },
              state.nodeId,
              layoutChildren,
            );
            if (dropResult) {
              useDragStore.getState().updateDrop(dropResult.indicator, dropResult.insertInfo, false);
            } else {
              useDragStore.getState().updateDrop(null, null, false);
            }
          } else {
            useDragStore.getState().updateDrop(null, null, true);
          }
        }
        return true;
      }

      // Dragging node (free drag)
      if (state.isDragging && state.nodeId) {
        const deltaX = world.x - state.startWorldX;
        const deltaY = world.y - state.startWorldY;

        let newX = state.startNodeX + deltaX;
        let newY = state.startNodeY + deltaY;

        // Apply axis lock if Shift was held at drag start (only for free drag, not auto-layout)
        if (state.isShiftHeld && !state.isAutoLayoutDrag) {
          state.cumulativeDeltaX = deltaX;
          state.cumulativeDeltaY = deltaY;

          const absDeltaX = Math.abs(deltaX);
          const absDeltaY = Math.abs(deltaY);
          const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

          // Below threshold: don't move element at all (prevents jitter)
          if (totalMovement < AXIS_LOCK_THRESHOLD) {
            newX = state.startNodeX;
            newY = state.startNodeY;
          } else {
            // Above threshold: determine dominant axis (only once)
            if (state.axisLock === null) {
              state.axisLock = absDeltaX >= absDeltaY ? "x" : "y";
            }

            // Lock to dominant axis
            if (state.axisLock === "x") {
              newY = state.startNodeY; // Lock Y, allow X
            } else {
              newX = state.startNodeX; // Lock X, allow Y
            }
          }
        }

        // Smart guide snapping
        if (state.snapTargets.length > 0) {
          const sceneState = useSceneStore.getState();
          const node = sceneState.nodesById[state.nodeId];
          if (node) {
            const scale = useViewportStore.getState().scale;
            const threshold = 2 / scale;

            const absX = newX + state.parentOffsetX;
            const absY = newY + state.parentOffsetY;

            const draggedEdges = getSnapEdges(absX, absY, node.width, node.height);
            const result = calculateSnap(draggedEdges, state.snapTargets, threshold);

            // Filter snap deltas based on axis lock
            let snapDeltaX = result.deltaX;
            let snapDeltaY = result.deltaY;
            let filteredGuides = result.guides;

            if (state.isShiftHeld && state.axisLock !== null) {
              if (state.axisLock === "x") {
                snapDeltaY = 0; // Don't snap locked Y axis
                filteredGuides = result.guides.filter(g => g.orientation === "horizontal");
              } else {
                snapDeltaX = 0; // Don't snap locked X axis
                filteredGuides = result.guides.filter(g => g.orientation === "vertical");
              }
            }

            newX += snapDeltaX;
            newY += snapDeltaY;

            if (filteredGuides.length > 0) {
              useSmartGuideStore.getState().setGuides(filteredGuides);
            } else {
              useSmartGuideStore.getState().clearGuides();
            }
          }
        }

        // Update node position without history (history saved on drag end)
        useSceneStore.getState().updateNodeWithoutHistory(state.nodeId, {
          x: Math.round(newX),
          y: Math.round(newY),
        });
        return true;
      }
      return false;
    },

    handlePointerUp(_e: PointerEvent, world: { x: number; y: number }): boolean {
      // End auto-layout drag
      if (state.isDragging && state.nodeId && state.isAutoLayoutDrag) {
        const dragStore = useDragStore.getState();
        const nodeId = state.nodeId;
        const sceneState = useSceneStore.getState();
        const node = sceneState.nodesById[nodeId];

        if (dragStore.isOutsideParent && node) {
          // Dragged out of auto-layout frame - extract to root level
          useSceneStore.getState().moveNode(nodeId, null, 0);
          useSceneStore.getState().updateNode(nodeId, {
            x: Math.round(world.x - node.width / 2),
            y: Math.round(world.y - node.height / 2),
          });
        } else if (dragStore.insertInfo) {
          // Reorder within the frame
          useSceneStore.getState().moveNode(
            nodeId,
            dragStore.insertInfo.parentId,
            dragStore.insertInfo.index,
          );
        }

        dragStore.endDrag();
        state.isDragging = false;
        state.nodeId = null;
        state.isAutoLayoutDrag = false;
        state.autoLayoutParentId = null;
        return true;
      }

      // End dragging (free drag)
      if (state.isDragging && state.nodeId) {
        useSmartGuideStore.getState().clearGuides();

        // Save history with the position change
        const sceneState = useSceneStore.getState();
        const node = sceneState.nodesById[state.nodeId];
        if (node && (node.x !== state.startNodeX || node.y !== state.startNodeY)) {
          // Commit the move with history
          useSceneStore.getState().updateNode(state.nodeId, {
            x: node.x,
            y: node.y,
          });
        }

        // Reset axis lock state
        state.isDragging = false;
        state.nodeId = null;
        state.isShiftHeld = false;
        state.axisLock = null;
        state.cumulativeDeltaX = 0;
        state.cumulativeDeltaY = 0;
        return true;
      }
      return false;
    },

    isDragging: () => state.isDragging,
  };
}
