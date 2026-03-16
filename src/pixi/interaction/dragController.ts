import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import { useHoverStore } from "@/store/hoverStore";
import { useDragStore } from "@/store/dragStore";
import { useLayoutStore } from "@/store/layoutStore";
import type { FlatFrameNode, FlatSceneNode, FrameNode, SceneNode } from "@/types/scene";
import { cloneNodeWithNewId } from "@/utils/cloneNode";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import {
  collectSnapTargets,
  getSnapEdges,
  calculateSnap,
} from "@/utils/smartGuideUtils";
import { getNodeAbsolutePositionWithLayout, getNodeEffectiveSize } from "@/utils/nodeUtils";
import {
  calculateDropPosition,
  isPointInsideRect,
  getFrameAbsoluteRectWithLayout,
} from "@/utils/dragUtils";
import type { SiblingPosition } from "@/utils/dragUtils";
import type { DragItem, InteractionContext, DragState } from "./types";
import { findFrameInTree } from "./hitTesting";
import {
  createAutoLayoutDragAnimator,
  type AutoLayoutDragAnimator,
} from "../autoLayoutDragAnimator";

const AXIS_LOCK_THRESHOLD = 8; // pixels

export interface DragController {
  handlePointerDown(
    e: PointerEvent,
    world: { x: number; y: number },
    hitId: string | null,
    dragSelectionIds?: string[],
  ): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerUp(e: PointerEvent, world: { x: number; y: number }): boolean;
  isDragging: () => boolean;
}

export function createDragController(context: InteractionContext): DragController {
  void context;

  const findNodeInTree = (nodes: SceneNode[], nodeId: string): SceneNode | null => {
    for (const node of nodes) {
      if (node.id === nodeId) return node;
      if (node.type === "frame" || node.type === "group") {
        const found = findNodeInTree(node.children, nodeId);
        if (found) return found;
      }
    }
    return null;
  };

  const state: DragState = {
    isDragging: false,
    nodeId: null,
    dragItems: [],
    startWorldX: 0,
    startWorldY: 0,
    startNodeX: 0,
    startNodeY: 0,
    parentOffsetX: 0,
    parentOffsetY: 0,
    startBoundsX: 0,
    startBoundsY: 0,
    startBoundsWidth: 0,
    startBoundsHeight: 0,
    snapTargets: [],
    snapOffsetX: 0,
    snapOffsetY: 0,
    isAutoLayoutDrag: false,
    autoLayoutParentId: null,
    isShiftHeld: false,
    isAltHeld: false,
    axisLock: null,
    cumulativeDeltaX: 0,
    cumulativeDeltaY: 0,
  };

  let animator: AutoLayoutDragAnimator | null = null;

  const resetDragState = (): void => {
    state.isDragging = false;
    state.nodeId = null;
    state.dragItems = [];
    state.isAutoLayoutDrag = false;
    state.autoLayoutParentId = null;
    state.isAltHeld = false;
    state.isShiftHeld = false;
    state.axisLock = null;
    state.cumulativeDeltaX = 0;
    state.cumulativeDeltaY = 0;
  };

  const resolveDragIds = (
    hitId: string | null,
    dragSelectionIds: string[] | undefined,
    effectiveSelectedIds: string[],
    sceneNodesById: Record<string, FlatSceneNode>,
  ): string[] => {
    if (dragSelectionIds && dragSelectionIds.length > 0) {
      return dragSelectionIds.filter((id) => !!sceneNodesById[id]);
    }

    if (hitId && effectiveSelectedIds.includes(hitId) && effectiveSelectedIds.length > 1) {
      return effectiveSelectedIds.filter((id) => !!sceneNodesById[id]);
    }

    return hitId ? [hitId] : [];
  };

  const collectDragItems = (
    dragIds: string[],
    nodes: SceneNode[],
    sceneNodesById: Record<string, FlatSceneNode>,
    calculateLayoutForFrame: ReturnType<typeof useLayoutStore.getState>["calculateLayoutForFrame"],
  ): DragItem[] =>
    dragIds
      .map((id) => {
        const dragNode = sceneNodesById[id];
        if (!dragNode) return null;

        const absPos = getNodeAbsolutePositionWithLayout(
          nodes,
          id,
          calculateLayoutForFrame,
        );
        const effectiveSize = getNodeEffectiveSize(nodes, id, calculateLayoutForFrame);
        if (!absPos || !effectiveSize) return null;

        return {
          id,
          startNodeX: dragNode.x,
          startNodeY: dragNode.y,
          startAbsX: absPos.x,
          startAbsY: absPos.y,
          parentOffsetX: absPos.x - dragNode.x,
          parentOffsetY: absPos.y - dragNode.y,
          width: effectiveSize.width,
          height: effectiveSize.height,
        };
      })
      .filter((item): item is DragItem => item !== null);

  const setDragBounds = (dragItems: DragItem[]): void => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const item of dragItems) {
      minX = Math.min(minX, item.startAbsX);
      minY = Math.min(minY, item.startAbsY);
      maxX = Math.max(maxX, item.startAbsX + item.width);
      maxY = Math.max(maxY, item.startAbsY + item.height);
    }

    state.startBoundsX = minX;
    state.startBoundsY = minY;
    state.startBoundsWidth = maxX - minX;
    state.startBoundsHeight = maxY - minY;
  };

  const updateDraggedNodesWithoutHistory = (
    adjustedDeltaX: number,
    adjustedDeltaY: number,
  ): void => {
    useSceneStore.setState((sceneState) => {
      const newNodesById = { ...sceneState.nodesById };
      let hasChanges = false;

      for (const item of state.dragItems) {
        const existing = newNodesById[item.id];
        if (!existing) continue;

        const nextX = Math.round(item.startNodeX + adjustedDeltaX);
        const nextY = Math.round(item.startNodeY + adjustedDeltaY);
        if (existing.x === nextX && existing.y === nextY) continue;

        newNodesById[item.id] = {
          ...existing,
          x: nextX,
          y: nextY,
        };
        hasChanges = true;
      }

      return hasChanges
        ? {
            nodesById: newNodesById,
            _cachedTree: null,
          }
        : sceneState;
    });
  };

  const computeDropFinalPosition = (
    parentFrame: FrameNode,
    insertIndex: number,
    draggedId: string,
    calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
    frameRect: { x: number; y: number },
  ): { x: number; y: number } => {
    const layoutChildren = calculateLayoutForFrame(parentFrame);
    // Filter out the dragged node from layout children
    const siblings = layoutChildren.filter((c) => c.id !== draggedId);

    const layout = parentFrame.layout;
    const isHorizontal = layout?.flexDirection === "row" || layout?.flexDirection === undefined;
    const gap = layout?.gap ?? 0;

    // Find the dragged child to know its size
    const draggedChild = parentFrame.children.find((c) => c.id === draggedId);
    const draggedWidth = draggedChild?.width ?? 0;
    const draggedHeight = draggedChild?.height ?? 0;

    if (siblings.length === 0) {
      // Only child — goes to first layout position
      const paddingLeft = layout?.paddingLeft ?? 0;
      const paddingTop = layout?.paddingTop ?? 0;
      return { x: frameRect.x + paddingLeft, y: frameRect.y + paddingTop };
    }

    if (insertIndex <= 0) {
      // Before the first sibling
      const first = siblings[0];
      if (isHorizontal) {
        return { x: frameRect.x + first.x - gap - draggedWidth, y: frameRect.y + first.y };
      } else {
        return { x: frameRect.x + first.x, y: frameRect.y + first.y - gap - draggedHeight };
      }
    }

    if (insertIndex >= siblings.length) {
      // After the last sibling
      const last = siblings[siblings.length - 1];
      if (isHorizontal) {
        return { x: frameRect.x + last.x + last.width + gap, y: frameRect.y + last.y };
      } else {
        return { x: frameRect.x + last.x, y: frameRect.y + last.y + last.height + gap };
      }
    }

    // Between two siblings — use the position of the sibling at insertIndex (before shift)
    const nextSibling = siblings[insertIndex];
    if (isHorizontal) {
      return { x: frameRect.x + nextSibling.x - gap - draggedWidth, y: frameRect.y + nextSibling.y };
    } else {
      return { x: frameRect.x + nextSibling.x, y: frameRect.y + nextSibling.y - gap - draggedHeight };
    }
  };

  return {
    handlePointerDown(
      e: PointerEvent,
      world: { x: number; y: number },
      hitId: string | null,
      dragSelectionIds?: string[],
    ): boolean {
      if (e.button === 0 && (hitId || (dragSelectionIds && dragSelectionIds.length > 0))) {
        const sceneState = useSceneStore.getState();
        const selectionState = useSelectionStore.getState();
        const currentSelectedIds = selectionState.selectedIds;
        const wasAlreadySelected = !!hitId && currentSelectedIds.includes(hitId);

        if (hitId) {
          if (e.shiftKey) {
            selectionState.addToSelection(hitId);
          } else if (!wasAlreadySelected || currentSelectedIds.length <= 1) {
            selectionState.select(hitId);
          }
        }

        // Cmd/Ctrl are selection modifiers - prevent drag
        // Shift is axis-lock modifier - allow drag
        if (e.metaKey || e.ctrlKey) {
          return false;
        }

        const effectiveSelectedIds = useSelectionStore.getState().selectedIds;
        const dragIds = resolveDragIds(
          hitId,
          dragSelectionIds,
          effectiveSelectedIds,
          sceneState.nodesById,
        );

        if (dragIds.length === 0) return false;

        const nodes = sceneState.getNodes();
        const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
        const dragItems = collectDragItems(
          dragIds,
          nodes,
          sceneState.nodesById,
          calculateLayoutForFrame,
        );

        if (dragItems.length === 0) return false;

        const primaryItem = dragItems.find((item) => item.id === hitId) ?? dragItems[0];
        const primaryNode = sceneState.nodesById[primaryItem.id];
        if (!primaryNode) return false;

        useHoverStore.getState().clearHovered();

        state.isDragging = true;
        state.nodeId = primaryItem.id;
        state.dragItems = dragItems;
        state.startWorldX = world.x;
        state.startWorldY = world.y;
        state.startNodeX = primaryItem.startNodeX;
        state.startNodeY = primaryItem.startNodeY;
        state.parentOffsetX = primaryItem.parentOffsetX;
        state.parentOffsetY = primaryItem.parentOffsetY;
        state.snapOffsetX = 0;
        state.snapOffsetY = 0;
        state.isAutoLayoutDrag = false;
        state.autoLayoutParentId = null;
        state.isShiftHeld = e.shiftKey;
        state.isAltHeld = e.altKey;
        state.axisLock = null;
        state.cumulativeDeltaX = 0;
        state.cumulativeDeltaY = 0;

        setDragBounds(dragItems);

        // Check if node is inside an auto-layout frame (skip for absolute-positioned nodes).
        // Multi-select drag uses free-drag semantics even if one of the nodes belongs to auto-layout.
        const parentId = sceneState.parentById[primaryItem.id];
        if (dragItems.length === 1 && parentId && !primaryNode.absolutePosition) {
          const parentNode = sceneState.nodesById[parentId];
          if (
            parentNode &&
            parentNode.type === "frame" &&
            (parentNode as FlatFrameNode).layout?.autoLayout
          ) {
            state.isAutoLayoutDrag = true;
            state.autoLayoutParentId = parentId;
            useDragStore.getState().startDrag(primaryItem.id);

            // Create and start the drag animator
            const parentFrame = findFrameInTree(nodes, parentId);
            if (parentFrame) {
              const layout = parentFrame.layout;
              const isHorizontal = layout?.flexDirection === "row" || layout?.flexDirection === undefined;
              const gap = layout?.gap ?? 0;

              // Compute sibling IDs (children excluding dragged node)
              const siblingIds = parentFrame.children
                .filter((c) => c.id !== primaryItem.id && c.visible !== false && c.enabled !== false)
                .map((c) => c.id);

              // Get dragged node's main axis size
              const draggedChild = parentFrame.children.find((c) => c.id === primaryItem.id);
              const draggedMainAxisSize = isHorizontal
                ? (draggedChild?.width ?? primaryItem.width)
                : (draggedChild?.height ?? primaryItem.height);

              // Compute sibling positions from current layout.
              // originalPositions: where siblings are now (with dragged node present) — for cancel restore.
              // noGapPositions: where siblings would be if dragged node is removed — shifted backward.
              const layoutChildren = calculateLayoutForFrame(parentFrame);
              const noGapPositions = new Map<string, SiblingPosition>();
              const originalPositions = new Map<string, SiblingPosition>();
              let pastDragged = false;
              const shift = draggedMainAxisSize + gap;
              for (const child of layoutChildren) {
                if (child.id === primaryItem.id) {
                  pastDragged = true;
                  continue;
                }
                originalPositions.set(child.id, { x: child.x, y: child.y });
                if (pastDragged) {
                  noGapPositions.set(child.id, {
                    x: child.x - (isHorizontal ? shift : 0),
                    y: child.y - (isHorizontal ? 0 : shift),
                  });
                } else {
                  noGapPositions.set(child.id, { x: child.x, y: child.y });
                }
              }

              animator = createAutoLayoutDragAnimator();
              animator.start({
                draggedId: primaryItem.id,
                parentId,
                siblingIds,
                noGapPositions,
                originalPositions,
                draggedMainAxisSize,
                gap,
                isHorizontal,
                startAbsX: primaryItem.startAbsX,
                startAbsY: primaryItem.startAbsY,
                startWorldX: world.x,
                startWorldY: world.y,
              });

              // Register cancel handler
              useDragStore.getState().setCancelDrag(() => {
                if (animator) {
                  animator.cancel();
                  animator.destroy();
                  animator = null;
                }
                useDragStore.getState().endDrag();
                resetDragState();
              });
            }
          }
        }

        // Collect snap targets (skip for auto-layout drags)
        if (!state.isAutoLayoutDrag) {
          const excludeIds = new Set(dragItems.map((item) => item.id));
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
        // Update ghost position via animator
        animator?.updateCursorWorld(world.x, world.y);

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
              animator?.updateInsertIndex(dropResult.insertInfo.index, false);
            } else {
              useDragStore.getState().updateDrop(null, null, false);
              animator?.updateInsertIndex(null, false);
            }
          } else {
            useDragStore.getState().updateDrop(null, null, true);
            animator?.updateInsertIndex(null, true);
          }
        }
        return true;
      }

      // Dragging node (free drag)
      if (state.isDragging && state.nodeId) {
        const deltaX = world.x - state.startWorldX;
        const deltaY = world.y - state.startWorldY;

        let adjustedDeltaX = deltaX;
        let adjustedDeltaY = deltaY;

        // Apply axis lock if Shift was held at drag start (only for free drag, not auto-layout)
        if (state.isShiftHeld && !state.isAutoLayoutDrag) {
          state.cumulativeDeltaX = deltaX;
          state.cumulativeDeltaY = deltaY;

          const absDeltaX = Math.abs(deltaX);
          const absDeltaY = Math.abs(deltaY);
          const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

          // Below threshold: don't move element at all (prevents jitter)
          if (totalMovement < AXIS_LOCK_THRESHOLD) {
            adjustedDeltaX = 0;
            adjustedDeltaY = 0;
          } else {
            // Above threshold: determine dominant axis (only once)
            if (state.axisLock === null) {
              state.axisLock = absDeltaX >= absDeltaY ? "x" : "y";
            }

            // Lock to dominant axis
            if (state.axisLock === "x") {
              adjustedDeltaY = 0; // Lock Y, allow X
            } else {
              adjustedDeltaX = 0; // Lock X, allow Y
            }
          }
        }

        // Smart guide snapping
        if (state.snapTargets.length > 0) {
          if (state.dragItems.length > 0) {
            const scale = useViewportStore.getState().scale;
            const threshold = 2 / scale;

            const draggedEdges = getSnapEdges(
              state.startBoundsX + adjustedDeltaX,
              state.startBoundsY + adjustedDeltaY,
              state.startBoundsWidth,
              state.startBoundsHeight,
            );
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

            adjustedDeltaX += snapDeltaX;
            adjustedDeltaY += snapDeltaY;

            if (filteredGuides.length > 0) {
              useSmartGuideStore.getState().setGuides(filteredGuides);
            } else {
              useSmartGuideStore.getState().clearGuides();
            }
          }
        }

        // Update dragged nodes without history (history saved on drag end)
        updateDraggedNodesWithoutHistory(adjustedDeltaX, adjustedDeltaY);
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
        const currentAnimator = animator;
        animator = null;

        // Block further pointer events immediately
        state.isDragging = false;

        const commitAndCleanup = (): void => {
          const ds = useDragStore.getState();
          if (ds.isOutsideParent && node) {
            useSceneStore.getState().moveNode(nodeId, null, 0);
            useSceneStore.getState().updateNode(nodeId, {
              x: Math.round(world.x - node.width / 2),
              y: Math.round(world.y - node.height / 2),
            });
          } else if (ds.insertInfo) {
            useSceneStore.getState().moveNode(
              nodeId,
              ds.insertInfo.parentId,
              ds.insertInfo.index,
            );
          }

          currentAnimator?.destroy();
          ds.endDrag();
          resetDragState();
        };

        if (currentAnimator && dragStore.insertInfo && !dragStore.isOutsideParent) {
          // Compute the final absolute position for the drop animation
          const nodes = sceneState.getNodes();
          const parentFrame = findFrameInTree(nodes, dragStore.insertInfo.parentId);
          if (parentFrame) {
            const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
            const frameRect = getFrameAbsoluteRectWithLayout(parentFrame, nodes, calculateLayoutForFrame);
            // Compute where the dragged node will land based on sibling positions
            const finalPos = computeDropFinalPosition(
              parentFrame,
              dragStore.insertInfo.index,
              nodeId,
              calculateLayoutForFrame,
              frameRect,
            );
            useDragStore.getState().setAnimationPhase("dropping");
            currentAnimator.animateDrop(finalPos.x, finalPos.y).then(commitAndCleanup);
          } else {
            commitAndCleanup();
          }
        } else {
          commitAndCleanup();
        }

        return true;
      }

      // End dragging (free drag)
      if (state.isDragging && state.nodeId) {
        useSmartGuideStore.getState().clearGuides();

        const sceneState = useSceneStore.getState();
        const movedItems = state.dragItems.filter((item) => {
          const node = sceneState.nodesById[item.id];
          return !!node && (node.x !== item.startNodeX || node.y !== item.startNodeY);
        });
        const primaryNode = sceneState.nodesById[state.nodeId];
        const hasMoved = movedItems.length > 0;
        const shouldDuplicateOnDrop = hasMoved && state.isShiftHeld && state.isAltHeld;

        if (primaryNode && shouldDuplicateOnDrop && state.dragItems.length === 1) {
          const treeNodes = sceneState.getNodes();
          const sourceTreeNode = findNodeInTree(treeNodes, state.nodeId);
          if (sourceTreeNode) {
            const clonedNode = cloneNodeWithNewId(sourceTreeNode, false);
            clonedNode.x = primaryNode.x;
            clonedNode.y = primaryNode.y;

            // Restore original to start position and then add a clone at drop point.
            useSceneStore.getState().updateNodeWithoutHistory(state.nodeId, {
              x: state.startNodeX,
              y: state.startNodeY,
            });

            const parentId = sceneState.parentById[state.nodeId];
            if (parentId !== null && parentId !== undefined) {
              useSceneStore.getState().addChildToFrame(parentId, clonedNode);
            } else {
              useSceneStore.getState().addNode(clonedNode);
            }
            useSelectionStore.getState().select(clonedNode.id);
          } else {
            // Fallback to normal move commit if source node can't be resolved.
            useSceneStore.getState().updateNode(state.nodeId, {
              x: primaryNode.x,
              y: primaryNode.y,
            });
          }
        } else if (hasMoved) {
          useSceneStore.setState((currentState) => {
            saveHistory(currentState);
            const newNodesById = { ...currentState.nodesById };

            for (const item of movedItems) {
              const currentNode = newNodesById[item.id];
              if (!currentNode) continue;
              newNodesById[item.id] = {
                ...currentNode,
                x: currentNode.x,
                y: currentNode.y,
              };
            }

            return {
              nodesById: newNodesById,
              _cachedTree: null,
            };
          });
        }

        resetDragState();
        return true;
      }
      return false;
    },

    isDragging: () => state.isDragging,
  };
}
