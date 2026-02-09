import { Application, CanvasTextMetrics, Container, TextStyle } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHoverStore } from "@/store/hoverStore";
import { useViewportStore } from "@/store/viewportStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import { useDragStore } from "@/store/dragStore";
import { useMeasureStore } from "@/store/measureStore";
import { useLayoutStore } from "@/store/layoutStore";
import type { SceneNode, FrameNode, FlatFrameNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import {
  collectSnapTargets,
  getSnapEdges,
  calculateSnap,
  type SnapTarget,
} from "@/utils/smartGuideUtils";
import {
  getNodeAbsolutePosition,
  getNodeAbsolutePositionWithLayout,
  getNodeEffectiveSize,
  findNodeById,
  findChildAtPosition,
  isDescendantOf,
} from "@/utils/nodeUtils";
import {
  computeParentDistances,
  computeSiblingDistances,
} from "@/utils/measureUtils";
import {
  calculateDropPosition,
  isPointInsideRect,
  getFrameAbsoluteRectWithLayout,
} from "@/utils/dragUtils";
import { setMarqueeRect } from "./pixiOverlayState";

interface DragState {
  isDragging: boolean;
  nodeId: string | null;
  startWorldX: number;
  startWorldY: number;
  startNodeX: number;
  startNodeY: number;
  parentOffsetX: number;
  parentOffsetY: number;
  snapTargets: SnapTarget[];
  snapOffsetX: number;
  snapOffsetY: number;
  // Auto-layout drag reordering
  isAutoLayoutDrag: boolean;
  autoLayoutParentId: string | null;
}

interface PanState {
  isPanning: boolean;
  startX: number;
  startY: number;
  startViewX: number;
  startViewY: number;
}

interface DrawState {
  isDrawing: boolean;
  startWorldX: number;
  startWorldY: number;
}

interface MarqueeState {
  isActive: boolean;
  startWorldX: number;
  startWorldY: number;
}

type HandleCorner = "tl" | "tr" | "bl" | "br";
type HandleSide = "l" | "r" | "t" | "b";
type TransformHandle = HandleCorner | HandleSide;

interface TransformState {
  isTransforming: boolean;
  nodeId: string | null;
  corner: TransformHandle | null;
  startNodeX: number;
  startNodeY: number;
  startNodeW: number;
  startNodeH: number;
  /** Absolute position of the node */
  absX: number;
  absY: number;
  parentOffsetX: number;
  parentOffsetY: number;
}

const LABEL_FONT_SIZE = 11;
const LABEL_OFFSET_Y = 4;
const LABEL_HIT_PADDING = 2;
const LABEL_FONT_FAMILY = "system-ui, -apple-system, sans-serif";

/**
 * Set up all pointer interaction handlers on the PixiJS canvas.
 * Returns a cleanup function.
 */
export function setupPixiInteraction(
  app: Application,
  _viewport: Container,
  _sceneRoot: Container,
): () => void {
  const canvas = app.canvas as HTMLCanvasElement;

  const drag: DragState = {
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
  };

  const pan: PanState = {
    isPanning: false,
    startX: 0,
    startY: 0,
    startViewX: 0,
    startViewY: 0,
  };

  const draw: DrawState = {
    isDrawing: false,
    startWorldX: 0,
    startWorldY: 0,
  };

  const marquee: MarqueeState = {
    isActive: false,
    startWorldX: 0,
    startWorldY: 0,
  };

  const transform: TransformState = {
    isTransforming: false,
    nodeId: null,
    corner: null,
    startNodeX: 0,
    startNodeY: 0,
    startNodeW: 0,
    startNodeH: 0,
    absX: 0,
    absY: 0,
    parentOffsetX: 0,
    parentOffsetY: 0,
  };

  let isSpaceHeld = false;

  // --- Coordinate helpers ---

  function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const vs = useViewportStore.getState();
    return {
      x: (screenX - vs.x) / vs.scale,
      y: (screenY - vs.y) / vs.scale,
    };
  }

  function findFrameLabelAtPoint(worldX: number, worldY: number): string | null {
    const scene = useSceneStore.getState();
    const { editingNodeId, editingMode } = useSelectionStore.getState();
    const scale = useViewportStore.getState().scale || 1;
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const treeNodes = scene.getNodes();

    const frameIds: string[] = [];

    // Match overlay visibility: top-level frames/groups only (same as Konva).
    for (const rootId of scene.rootIds) {
      const node = scene.nodesById[rootId];
      if (!node || node.visible === false) continue;
      if (node.type !== "frame" && node.type !== "group") continue;
      frameIds.push(rootId);
    }

    // Hit-test from top-most drawn label to bottom-most.
    for (let i = frameIds.length - 1; i >= 0; i--) {
      const frameId = frameIds[i];

      // Hidden while editing this exact name.
      if (editingNodeId === frameId && editingMode === "name") continue;

      const node = scene.nodesById[frameId];
      if (!node) continue;

      const absPos = getNodeAbsolutePositionWithLayout(
        treeNodes,
        frameId,
        calculateLayoutForFrame,
      );
      if (!absPos) continue;

      const defaultName = node.type === "group" ? "Group" : "Frame";
      const displayName = node.name || defaultName;

      const worldOffsetY = (LABEL_FONT_SIZE + LABEL_OFFSET_Y) / scale;
      const labelX = absPos.x;
      const labelY = absPos.y - worldOffsetY;
      const textStyle = new TextStyle({
        fontFamily: LABEL_FONT_FAMILY,
        fontSize: LABEL_FONT_SIZE,
      });
      const textMetrics = CanvasTextMetrics.measureText(displayName, textStyle);
      const labelW = textMetrics.width / scale;
      const labelH = LABEL_FONT_SIZE / scale;
      const padding = LABEL_HIT_PADDING / scale;

      if (
        worldX >= labelX - padding &&
        worldX <= labelX + labelW + padding &&
        worldY >= labelY - padding &&
        worldY <= labelY + labelH + padding
      ) {
        return frameId;
      }
    }

    return null;
  }

  function findNodeAtPoint(
    worldX: number,
    worldY: number,
    options?: { deepSelect?: boolean },
  ): string | null {
    if (options?.deepSelect) {
      return findDeepestNodeAtPoint(worldX, worldY);
    }

    const state = useSceneStore.getState();

    // Walk rootIds in reverse (top-most first)
    for (let i = state.rootIds.length - 1; i >= 0; i--) {
      const hit = hitTestNode(
        state.rootIds[i],
        worldX,
        worldY,
        0,
        0,
        state,
        false,
      );
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Deep-select hit test used for Cmd/Ctrl+Click.
   * Returns the deepest node under cursor using layout-aware child positions.
   */
  function findDeepestNodeAtPoint(worldX: number, worldY: number): string | null {
    const state = useSceneStore.getState();
    const sceneNodes = state.getNodes();
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;

    const hitInList = (
      nodes: SceneNode[],
      parentAbsX: number,
      parentAbsY: number,
    ): string | null => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (node.visible === false) continue;

        const absX = parentAbsX + node.x;
        const absY = parentAbsY + node.y;
        const effectiveSize = getNodeEffectiveSize(sceneNodes, node.id, calculateLayoutForFrame);
        const width = effectiveSize?.width ?? node.width;
        const height = effectiveSize?.height ?? node.height;

        if (
          worldX < absX ||
          worldX > absX + width ||
          worldY < absY ||
          worldY > absY + height
        ) {
          continue;
        }

        if (node.type === "frame" || node.type === "group") {
          const childList =
            node.type === "frame" && node.layout?.autoLayout
              ? calculateLayoutForFrame(node)
              : node.children;
          const childHit = hitInList(childList, absX, absY);
          if (childHit) return childHit;
        }

        return node.id;
      }
      return null;
    };

    return hitInList(sceneNodes, 0, 0);
  }

  function hitTestNode(
    nodeId: string,
    worldX: number,
    worldY: number,
    parentAbsX: number,
    parentAbsY: number,
    state: typeof useSceneStore extends { getState: () => infer S } ? S : never,
    deepSelect: boolean,
  ): string | null {
    const node = state.nodesById[nodeId];
    if (!node || node.visible === false) return null;

    const absX = parentAbsX + node.x;
    const absY = parentAbsY + node.y;

    // Check if point is within bounds
    if (
      worldX < absX ||
      worldX > absX + node.width ||
      worldY < absY ||
      worldY > absY + node.height
    ) {
      return null;
    }

    // Check children first (deeper elements have priority)
    const childIds = state.childrenById[nodeId] ?? [];
    for (let i = childIds.length - 1; i >= 0; i--) {
      const childHit = hitTestNode(
        childIds[i],
        worldX,
        worldY,
        absX,
        absY,
        state,
        deepSelect,
      );
      if (childHit) {
        if (deepSelect) return childHit;
        // Nested selection logic: check if we should select the child or the parent
        const enteredContainerId = useSelectionStore.getState().enteredContainerId;
        if (enteredContainerId === nodeId) {
          return childHit;
        }
        // If this is a top-level frame, select the frame itself (not children)
        // unless user has entered the container via double-click
        if (state.parentById[nodeId] === null) {
          return nodeId;
        }
        return nodeId;
      }
    }

    return nodeId;
  }

  /**
   * Check if a world-space point is near a transform handle of the current selection.
   * Returns the active transform handle identifier or null.
   */
  function hitTestTransformHandle(worldX: number, worldY: number): {
    corner: TransformHandle;
    nodeId: string;
    absX: number;
    absY: number;
    width: number;
    height: number;
  } | null {
    const { selectedIds } = useSelectionStore.getState();
    if (selectedIds.length !== 1) return null;

    const state = useSceneStore.getState();
    const nodeId = selectedIds[0];
    const node = state.nodesById[nodeId];
    if (!node) return null;

    const treeNodes = state.getNodes();
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const absPos = getNodeAbsolutePositionWithLayout(treeNodes, nodeId, calculateLayoutForFrame);
    if (!absPos) return null;
    const effectiveSize = getNodeEffectiveSize(treeNodes, nodeId, calculateLayoutForFrame);
    const width = effectiveSize?.width ?? node.width;
    const height = effectiveSize?.height ?? node.height;
    const absX = absPos.x;
    const absY = absPos.y;

    const scale = useViewportStore.getState().scale;
    const handleRadius = 6 / scale; // Hit area slightly larger than visual handle

    const corners: Array<{ corner: HandleCorner; cx: number; cy: number }> = [
      { corner: "tl", cx: absX, cy: absY },
      { corner: "tr", cx: absX + width, cy: absY },
      { corner: "bl", cx: absX, cy: absY + height },
      { corner: "br", cx: absX + width, cy: absY + height },
    ];

    for (const { corner, cx, cy } of corners) {
      const dx = worldX - cx;
      const dy = worldY - cy;
      if (Math.abs(dx) <= handleRadius && Math.abs(dy) <= handleRadius) {
        return { corner, nodeId, absX, absY, width, height };
      }
    }

    // Side handles (skip corner zones to avoid ambiguity)
    const sideTolerance = handleRadius;
    const cornerExclusion = handleRadius * 2;
    const distLeft = Math.abs(worldX - absX);
    const distRight = Math.abs(worldX - (absX + width));
    const distTop = Math.abs(worldY - absY);
    const distBottom = Math.abs(worldY - (absY + height));

    if (
      distLeft <= sideTolerance &&
      worldY >= absY + cornerExclusion &&
      worldY <= absY + height - cornerExclusion
    ) {
      return { corner: "l", nodeId, absX, absY, width, height };
    }
    if (
      distRight <= sideTolerance &&
      worldY >= absY + cornerExclusion &&
      worldY <= absY + height - cornerExclusion
    ) {
      return { corner: "r", nodeId, absX, absY, width, height };
    }
    if (
      distTop <= sideTolerance &&
      worldX >= absX + cornerExclusion &&
      worldX <= absX + width - cornerExclusion
    ) {
      return { corner: "t", nodeId, absX, absY, width, height };
    }
    if (
      distBottom <= sideTolerance &&
      worldX >= absX + cornerExclusion &&
      worldX <= absX + width - cornerExclusion
    ) {
      return { corner: "b", nodeId, absX, absY, width, height };
    }

    return null;
  }

  function getResizeCursor(corner: TransformHandle): string {
    switch (corner) {
      case "tl": case "br": return "nwse-resize";
      case "tr": case "bl": return "nesw-resize";
      case "l": case "r": return "ew-resize";
      case "t": case "b": return "ns-resize";
    }
  }

  /**
   * Find a tree-based FrameNode by ID in the tree structure.
   */
  function findFrameInTree(nodes: SceneNode[], frameId: string): FrameNode | null {
    for (const node of nodes) {
      if (node.id === frameId && node.type === "frame") return node as FrameNode;
      if (node.type === "frame" || node.type === "group") {
        const children = (node as FrameNode).children;
        if (children) {
          const found = findFrameInTree(children, frameId);
          if (found) return found;
        }
      }
    }
    return null;
  }

  // --- Wheel handler ---

  function handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const centerX = e.clientX - rect.left;
    const centerY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      // Pinch-to-zoom
      useViewportStore.getState().startSmoothZoom(e.deltaY, centerX, centerY);
    } else {
      // Two-finger scroll = pan (matches Konva behavior)
      const vs = useViewportStore.getState();
      const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
      const dy = e.shiftKey ? 0 : -e.deltaY;
      vs.setPosition(vs.x + dx, vs.y + dy);
    }
  }

  // --- Pointer handlers ---

  function handlePointerDown(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);

    // Middle mouse button -> pan
    if (e.button === 1) {
      pan.isPanning = true;
      pan.startX = e.clientX;
      pan.startY = e.clientY;
      const vs = useViewportStore.getState();
      pan.startViewX = vs.x;
      pan.startViewY = vs.y;
      useViewportStore.getState().setIsPanning(true);
      canvas.style.cursor = "grabbing";
      return;
    }

    // Space+click -> pan
    if (isSpaceHeld && e.button === 0) {
      pan.isPanning = true;
      pan.startX = e.clientX;
      pan.startY = e.clientY;
      const vs = useViewportStore.getState();
      pan.startViewX = vs.x;
      pan.startViewY = vs.y;
      useViewportStore.getState().setIsPanning(true);
      canvas.style.cursor = "grabbing";
      return;
    }

    // Check for transform handle hit
    if (e.button === 0) {
      const handleHit = hitTestTransformHandle(world.x, world.y);
      if (handleHit) {
        const state = useSceneStore.getState();
        const node = state.nodesById[handleHit.nodeId];
        if (node) {
          transform.isTransforming = true;
          transform.nodeId = handleHit.nodeId;
          transform.corner = handleHit.corner;
          transform.startNodeX = node.x;
          transform.startNodeY = node.y;
          transform.startNodeW = handleHit.width;
          transform.startNodeH = handleHit.height;
          transform.absX = handleHit.absX;
          transform.absY = handleHit.absY;
          transform.parentOffsetX = handleHit.absX - node.x;
          transform.parentOffsetY = handleHit.absY - node.y;
          canvas.style.cursor = getResizeCursor(handleHit.corner);
          return;
        }
      }
    }

    // Drawing mode
    const { activeTool } = useDrawModeStore.getState();
    if (activeTool && activeTool !== "cursor" && e.button === 0) {
      draw.isDrawing = true;
      draw.startWorldX = world.x;
      draw.startWorldY = world.y;
      useDrawModeStore.getState().startDrawing({ x: world.x, y: world.y });
      return;
    }

    // Left button click
    if (e.button === 0) {
      const labelHitId = findFrameLabelAtPoint(world.x, world.y);
      if (labelHitId) {
        const state = useSceneStore.getState();
        const node = state.nodesById[labelHitId];
        if (!node) return;

        if (e.shiftKey) {
          useSelectionStore.getState().addToSelection(labelHitId);
        } else {
          useSelectionStore.getState().select(labelHitId);
        }

        drag.isDragging = true;
        drag.nodeId = labelHitId;
        drag.startWorldX = world.x;
        drag.startWorldY = world.y;
        drag.startNodeX = node.x;
        drag.startNodeY = node.y;
        drag.snapOffsetX = 0;
        drag.snapOffsetY = 0;
        drag.isAutoLayoutDrag = false;
        drag.autoLayoutParentId = null;

        const nodes = state.getNodes();
        const absPos = getNodeAbsolutePosition(nodes, labelHitId);
        if (absPos) {
          drag.parentOffsetX = absPos.x - node.x;
          drag.parentOffsetY = absPos.y - node.y;
        } else {
          drag.parentOffsetX = 0;
          drag.parentOffsetY = 0;
        }

        const selectedIds = useSelectionStore.getState().selectedIds;
        const excludeIds = new Set(selectedIds);
        drag.snapTargets = collectSnapTargets(nodes, excludeIds);
        return;
      }

      const deepSelect = e.metaKey || e.ctrlKey;
      const hitId = findNodeAtPoint(world.x, world.y, { deepSelect });

      if (hitId) {
        // Start drag
        const state = useSceneStore.getState();
        const node = state.nodesById[hitId];
        if (!node) return;

        // Select
        if (e.shiftKey) {
          useSelectionStore.getState().addToSelection(hitId);
        } else {
          useSelectionStore.getState().select(hitId);
        }

        drag.isDragging = true;
        drag.nodeId = hitId;
        drag.startWorldX = world.x;
        drag.startWorldY = world.y;
        drag.startNodeX = node.x;
        drag.startNodeY = node.y;
        drag.snapOffsetX = 0;
        drag.snapOffsetY = 0;
        drag.isAutoLayoutDrag = false;
        drag.autoLayoutParentId = null;

        // Check if node is inside an auto-layout frame
        const parentId = state.parentById[hitId];
        if (parentId) {
          const parentNode = state.nodesById[parentId];
          if (
            parentNode &&
            parentNode.type === "frame" &&
            (parentNode as FlatFrameNode).layout?.autoLayout
          ) {
            drag.isAutoLayoutDrag = true;
            drag.autoLayoutParentId = parentId;
            useDragStore.getState().startDrag(hitId);
          }
        }

        // Compute parent offset for absolute position
        const nodes = state.getNodes();
        const absPos = getNodeAbsolutePosition(nodes, hitId);
        if (absPos) {
          drag.parentOffsetX = absPos.x - node.x;
          drag.parentOffsetY = absPos.y - node.y;
        } else {
          drag.parentOffsetX = 0;
          drag.parentOffsetY = 0;
        }

        // Collect snap targets (skip for auto-layout drags)
        if (!drag.isAutoLayoutDrag) {
          const selectedIds = useSelectionStore.getState().selectedIds;
          const excludeIds = new Set(selectedIds);
          drag.snapTargets = collectSnapTargets(nodes, excludeIds);
        } else {
          drag.snapTargets = [];
        }
      } else {
        // Click on background
        useSelectionStore.getState().clearSelection();
        useSelectionStore.getState().resetContainerContext();

        // Start marquee selection
        marquee.isActive = true;
        marquee.startWorldX = world.x;
        marquee.startWorldY = world.y;
      }
    }
  }

  function handlePointerMove(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);

    // Panning
    if (pan.isPanning) {
      const dx = e.clientX - pan.startX;
      const dy = e.clientY - pan.startY;
      useViewportStore.getState().setPosition(
        pan.startViewX + dx,
        pan.startViewY + dy,
      );
      return;
    }

    // Drawing
    if (draw.isDrawing) {
      useDrawModeStore.getState().updateDrawing({ x: world.x, y: world.y });
      return;
    }

    // Transform (resize)
    if (transform.isTransforming && transform.nodeId && transform.corner) {
      const MIN_SIZE = 5;
      const corner = transform.corner;
      const absWorldX = world.x;
      const absWorldY = world.y;

      let newX = transform.startNodeX;
      let newY = transform.startNodeY;
      let newW = transform.startNodeW;
      let newH = transform.startNodeH;

      // Compute bounding box edges in absolute coordinates
      const origLeft = transform.absX;
      const origTop = transform.absY;
      const origRight = origLeft + transform.startNodeW;
      const origBottom = origTop + transform.startNodeH;

      if (corner === "br") {
        newW = Math.max(MIN_SIZE, absWorldX - origLeft);
        newH = Math.max(MIN_SIZE, absWorldY - origTop);
      } else if (corner === "bl") {
        const newRight = origRight;
        const newLeft = Math.min(absWorldX, newRight - MIN_SIZE);
        newW = newRight - newLeft;
        newX = transform.startNodeX + (newLeft - origLeft);
        newH = Math.max(MIN_SIZE, absWorldY - origTop);
      } else if (corner === "tr") {
        newW = Math.max(MIN_SIZE, absWorldX - origLeft);
        const newBottom = origBottom;
        const newTop = Math.min(absWorldY, newBottom - MIN_SIZE);
        newH = newBottom - newTop;
        newY = transform.startNodeY + (newTop - origTop);
      } else if (corner === "tl") {
        const newRight = origRight;
        const newBottom = origBottom;
        const newLeft = Math.min(absWorldX, newRight - MIN_SIZE);
        const newTop = Math.min(absWorldY, newBottom - MIN_SIZE);
        newW = newRight - newLeft;
        newH = newBottom - newTop;
        newX = transform.startNodeX + (newLeft - origLeft);
        newY = transform.startNodeY + (newTop - origTop);
      } else if (corner === "r") {
        newW = Math.max(MIN_SIZE, absWorldX - origLeft);
      } else if (corner === "l") {
        const newRight = origRight;
        const newLeft = Math.min(absWorldX, newRight - MIN_SIZE);
        newW = newRight - newLeft;
        newX = transform.startNodeX + (newLeft - origLeft);
      } else if (corner === "b") {
        newH = Math.max(MIN_SIZE, absWorldY - origTop);
      } else if (corner === "t") {
        const newBottom = origBottom;
        const newTop = Math.min(absWorldY, newBottom - MIN_SIZE);
        newH = newBottom - newTop;
        newY = transform.startNodeY + (newTop - origTop);
      }

      useSceneStore.getState().updateNodeWithoutHistory(transform.nodeId, {
        x: Math.round(newX),
        y: Math.round(newY),
        width: Math.round(newW),
        height: Math.round(newH),
      });
      return;
    }

    // Auto-layout drag reordering
    if (drag.isDragging && drag.nodeId && drag.isAutoLayoutDrag && drag.autoLayoutParentId) {
      const state = useSceneStore.getState();
      const nodes = state.getNodes();
      const parentFrame = findFrameInTree(nodes, drag.autoLayoutParentId);
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
            drag.nodeId,
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
      return;
    }

    // Dragging node (free drag)
    if (drag.isDragging && drag.nodeId) {
      const deltaX = world.x - drag.startWorldX;
      const deltaY = world.y - drag.startWorldY;

      let newX = drag.startNodeX + deltaX;
      let newY = drag.startNodeY + deltaY;

      // Smart guide snapping
      if (drag.snapTargets.length > 0) {
        const state = useSceneStore.getState();
        const node = state.nodesById[drag.nodeId];
        if (node) {
          const scale = useViewportStore.getState().scale;
          const threshold = 2 / scale;

          const absX = newX + drag.parentOffsetX;
          const absY = newY + drag.parentOffsetY;

          const draggedEdges = getSnapEdges(absX, absY, node.width, node.height);
          const result = calculateSnap(draggedEdges, drag.snapTargets, threshold);

          newX += result.deltaX;
          newY += result.deltaY;

          if (result.guides.length > 0) {
            useSmartGuideStore.getState().setGuides(result.guides);
          } else {
            useSmartGuideStore.getState().clearGuides();
          }
        }
      }

      // Update node position without history (history saved on drag end)
      useSceneStore.getState().updateNodeWithoutHistory(drag.nodeId, {
        x: Math.round(newX),
        y: Math.round(newY),
      });
      return;
    }

    // Marquee selection
    if (marquee.isActive) {
      const x = Math.min(marquee.startWorldX, world.x);
      const y = Math.min(marquee.startWorldY, world.y);
      const w = Math.abs(world.x - marquee.startWorldX);
      const h = Math.abs(world.y - marquee.startWorldY);
      setMarqueeRect({ x, y, width: w, height: h });
      return;
    }

    // Hover detection
    const hitId = findNodeAtPoint(world.x, world.y, { deepSelect: true });
    useHoverStore.getState().setHoveredNode(hitId);

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

    // Update cursor for transform handles
    const handleHit = hitTestTransformHandle(world.x, world.y);
    if (handleHit) {
      canvas.style.cursor = getResizeCursor(handleHit.corner);
    } else if (!drag.isDragging && !pan.isPanning) {
      const { activeTool } = useDrawModeStore.getState();
      canvas.style.cursor = activeTool && activeTool !== "cursor" ? "crosshair" : "";
    }
  }

  function handlePointerUp(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);

    // End panning
    if (pan.isPanning) {
      pan.isPanning = false;
      useViewportStore.getState().setIsPanning(false);
      canvas.style.cursor = "";
      return;
    }

    // End transform
    if (transform.isTransforming && transform.nodeId) {
      const state = useSceneStore.getState();
      const node = state.nodesById[transform.nodeId];
      if (node) {
        // Commit the resize with history
        useSceneStore.getState().updateNode(transform.nodeId, {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        });
      }
      transform.isTransforming = false;
      transform.nodeId = null;
      transform.corner = null;
      canvas.style.cursor = "";
      return;
    }

    // End drawing
    if (draw.isDrawing) {
      draw.isDrawing = false;
      const { activeTool } = useDrawModeStore.getState();
      if (activeTool) {
        const x = Math.min(draw.startWorldX, world.x);
        const y = Math.min(draw.startWorldY, world.y);
        const width = Math.max(Math.abs(world.x - draw.startWorldX), 10);
        const height = Math.max(Math.abs(world.y - draw.startWorldY), 10);

        createDrawnNode(activeTool, x, y, width, height);
      }
      useDrawModeStore.getState().endDrawing();
      return;
    }

    // End auto-layout drag
    if (drag.isDragging && drag.nodeId && drag.isAutoLayoutDrag) {
      const dragStore = useDragStore.getState();
      const nodeId = drag.nodeId;
      const state = useSceneStore.getState();
      const node = state.nodesById[nodeId];

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
      drag.isDragging = false;
      drag.nodeId = null;
      drag.isAutoLayoutDrag = false;
      drag.autoLayoutParentId = null;
      return;
    }

    // End dragging (free drag)
    if (drag.isDragging && drag.nodeId) {
      useSmartGuideStore.getState().clearGuides();

      // Save history with the position change
      const state = useSceneStore.getState();
      const node = state.nodesById[drag.nodeId];
      if (node && (node.x !== drag.startNodeX || node.y !== drag.startNodeY)) {
        // Commit the move with history
        useSceneStore.getState().updateNode(drag.nodeId, {
          x: node.x,
          y: node.y,
        });
      }

      drag.isDragging = false;
      drag.nodeId = null;
      return;
    }

    // End marquee selection
    if (marquee.isActive) {
      marquee.isActive = false;
      setMarqueeRect(null);

      const x1 = Math.min(marquee.startWorldX, world.x);
      const y1 = Math.min(marquee.startWorldY, world.y);
      const x2 = Math.max(marquee.startWorldX, world.x);
      const y2 = Math.max(marquee.startWorldY, world.y);

      // Find all nodes intersecting the marquee
      if (Math.abs(x2 - x1) > 2 || Math.abs(y2 - y1) > 2) {
        const state = useSceneStore.getState();
        const ids: string[] = [];
        for (const rootId of state.rootIds) {
          const node = state.nodesById[rootId];
          if (!node || node.visible === false) continue;
          const nodeRight = node.x + node.width;
          const nodeBottom = node.y + node.height;
          if (node.x < x2 && nodeRight > x1 && node.y < y2 && nodeBottom > y1) {
            ids.push(rootId);
          }
        }
        if (ids.length > 0) {
          useSelectionStore.getState().setSelectedIds(ids);
        }
      }
    }
  }

  function handleDblClick(e: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);

    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const currentSelectedIds = useSelectionStore.getState().selectedIds;
    const currentNodes = useSceneStore.getState().getNodes();

    const frameLabelHitId = findFrameLabelAtPoint(world.x, world.y);
    if (frameLabelHitId) {
      useSelectionStore.getState().select(frameLabelHitId);
      useSelectionStore.getState().startNameEditing(frameLabelHitId);
      return;
    }

    // Match Konva behavior: drill down from currently selected container.
    if (currentSelectedIds.length === 1) {
      const selectedNode = findNodeById(currentNodes, currentSelectedIds[0]);
      if (selectedNode && (selectedNode.type === "frame" || selectedNode.type === "group")) {
        useSelectionStore.getState().enterContainer(selectedNode.id);

        const absPos = getNodeAbsolutePositionWithLayout(
          currentNodes,
          selectedNode.id,
          calculateLayoutForFrame,
        );
        if (!absPos) return;

        const localX = world.x - absPos.x;
        const localY = world.y - absPos.y;
        const hitChildren =
          selectedNode.type === "frame" && selectedNode.layout?.autoLayout
            ? calculateLayoutForFrame(selectedNode)
            : selectedNode.children;
        const childId = findChildAtPosition(hitChildren, localX, localY);
        if (childId) {
          useSelectionStore.getState().select(childId);
        }
        return;
      }
    }

    const deepSelect = e.metaKey || e.ctrlKey;
    const hitId = findNodeAtPoint(world.x, world.y, { deepSelect });
    if (!hitId) return;

    const state = useSceneStore.getState();
    const node = state.nodesById[hitId];
    if (!node) return;

    if (node.type === "text") {
      // Enter text editing mode
      useSelectionStore.getState().startEditing(hitId);
    } else if (node.type === "frame" || node.type === "group") {
      // Enter container (fallback when no selected container context)
      useSelectionStore.getState().enterContainer(hitId);
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.code === "Space" && !e.repeat) {
      isSpaceHeld = true;
    }
  }

  function handleKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space") {
      isSpaceHeld = false;
    }
  }

  function handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  // --- Drawing node creation ---

  function createDrawnNode(
    tool: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const id = generateId();
    let node: SceneNode;

    switch (tool) {
      case "frame":
        node = {
          id,
          type: "frame",
          x,
          y,
          width,
          height,
          fill: "#ffffff",
          stroke: "#cccccc",
          strokeWidth: 1,
          children: [],
        };
        break;
      case "rect":
        node = { id, type: "rect", x, y, width, height, fill: "#cccccc" };
        break;
      case "ellipse":
        node = { id, type: "ellipse", x, y, width, height, fill: "#cccccc" };
        break;
      case "text":
        node = {
          id,
          type: "text",
          x,
          y,
          width,
          height,
          text: "Text",
          fontSize: 14,
          fill: "#000000",
        };
        break;
      case "line":
        node = {
          id,
          type: "line",
          x,
          y,
          width,
          height,
          stroke: "#000000",
          strokeWidth: 2,
          points: [0, 0, width, height],
        };
        break;
      case "polygon":
        node = {
          id,
          type: "polygon",
          x,
          y,
          width,
          height,
          fill: "#cccccc",
          sides: 6,
          points: [],
        };
        break;
      default:
        return;
    }

    useSceneStore.getState().addNode(node);
    useSelectionStore.getState().select(id);
  }

  // --- Event listeners ---

  canvas.addEventListener("wheel", handleWheel, { passive: false });
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("dblclick", handleDblClick);
  canvas.addEventListener("contextmenu", handleContextMenu);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  return () => {
    canvas.removeEventListener("wheel", handleWheel);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("dblclick", handleDblClick);
    canvas.removeEventListener("contextmenu", handleContextMenu);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
  };
}
