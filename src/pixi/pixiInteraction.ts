import { Application, Container } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHoverStore } from "@/store/hoverStore";
import { useViewportStore } from "@/store/viewportStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import type { SceneNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import {
  collectSnapTargets,
  getSnapEdges,
  calculateSnap,
  type SnapTarget,
} from "@/utils/smartGuideUtils";
import { getNodeAbsolutePosition } from "@/utils/nodeUtils";
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

interface TransformState {
  isTransforming: boolean;
  nodeId: string | null;
  corner: HandleCorner | null;
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

  function findNodeAtPoint(worldX: number, worldY: number): string | null {
    const state = useSceneStore.getState();

    // Walk rootIds in reverse (top-most first)
    for (let i = state.rootIds.length - 1; i >= 0; i--) {
      const hit = hitTestNode(state.rootIds[i], worldX, worldY, 0, 0, state);
      if (hit) return hit;
    }
    return null;
  }

  function hitTestNode(
    nodeId: string,
    worldX: number,
    worldY: number,
    parentAbsX: number,
    parentAbsY: number,
    state: typeof useSceneStore extends { getState: () => infer S } ? S : never,
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
      const childHit = hitTestNode(childIds[i], worldX, worldY, absX, absY, state);
      if (childHit) {
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
   * Returns the corner identifier or null.
   */
  function hitTestTransformHandle(worldX: number, worldY: number): {
    corner: HandleCorner;
    nodeId: string;
    absX: number;
    absY: number;
  } | null {
    const { selectedIds } = useSelectionStore.getState();
    if (selectedIds.length !== 1) return null;

    const state = useSceneStore.getState();
    const nodeId = selectedIds[0];
    const node = state.nodesById[nodeId];
    if (!node) return null;

    // Get absolute position
    let absX = node.x;
    let absY = node.y;
    let pid = state.parentById[nodeId];
    while (pid) {
      const p = state.nodesById[pid];
      if (p) { absX += p.x; absY += p.y; }
      pid = state.parentById[pid];
    }

    const scale = useViewportStore.getState().scale;
    const handleRadius = 6 / scale; // Hit area slightly larger than visual handle

    const corners: Array<{ corner: HandleCorner; cx: number; cy: number }> = [
      { corner: "tl", cx: absX, cy: absY },
      { corner: "tr", cx: absX + node.width, cy: absY },
      { corner: "bl", cx: absX, cy: absY + node.height },
      { corner: "br", cx: absX + node.width, cy: absY + node.height },
    ];

    for (const { corner, cx, cy } of corners) {
      const dx = worldX - cx;
      const dy = worldY - cy;
      if (Math.abs(dx) <= handleRadius && Math.abs(dy) <= handleRadius) {
        return { corner, nodeId, absX, absY };
      }
    }
    return null;
  }

  function getResizeCursor(corner: HandleCorner): string {
    switch (corner) {
      case "tl": case "br": return "nwse-resize";
      case "tr": case "bl": return "nesw-resize";
    }
  }

  // --- Wheel handler ---

  function handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const centerX = e.clientX - rect.left;
    const centerY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      // Pinch-to-zoom
      useViewportStore.getState().startSmoothZoom(-e.deltaY * 3, centerX, centerY);
    } else {
      // Scroll-to-zoom
      useViewportStore.getState().startSmoothZoom(e.deltaY, centerX, centerY);
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
          transform.startNodeW = node.width;
          transform.startNodeH = node.height;
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
      const hitId = findNodeAtPoint(world.x, world.y);

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

        // Collect snap targets
        const selectedIds = useSelectionStore.getState().selectedIds;
        const excludeIds = new Set(selectedIds);
        drag.snapTargets = collectSnapTargets(nodes, excludeIds);
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
      }

      useSceneStore.getState().updateNodeWithoutHistory(transform.nodeId, {
        x: Math.round(newX),
        y: Math.round(newY),
        width: Math.round(newW),
        height: Math.round(newH),
      });
      return;
    }

    // Dragging node
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
    const hitId = findNodeAtPoint(world.x, world.y);
    useHoverStore.getState().setHoveredNode(hitId);

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

    // End dragging
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

    const hitId = findNodeAtPoint(world.x, world.y);
    if (!hitId) return;

    const state = useSceneStore.getState();
    const node = state.nodesById[hitId];
    if (!node) return;

    if (node.type === "text") {
      // Enter text editing mode
      useSelectionStore.getState().startEditing(hitId);
    } else if (node.type === "frame" || node.type === "group") {
      // Enter container
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
