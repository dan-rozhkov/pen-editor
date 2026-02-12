import { Application, Container } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHoverStore } from "@/store/hoverStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useLayoutStore } from "@/store/layoutStore";
import {
  findNodeById,
  findDeepestChildAtPosition,
  getNodeAbsolutePositionWithLayout,
} from "@/utils/nodeUtils";
import type { InteractionContext } from "./types";
import { screenToWorld, findNodeAtPoint, findFrameLabelAtPoint, hitTestTransformHandle, getResizeCursor } from "./hitTesting";
import { createPanController } from "./panController";
import { createTransformController } from "./transformController";
import { createDrawController } from "./drawController";
import { createDragController } from "./dragController";
import { createMarqueeController } from "./marqueeController";
import { createMeasurementController } from "./measurementController";
import { prepareFrameNode, prepareInstanceNode } from "@/components/nodes/instanceUtils";

function findInstanceDescendantAtWorldPoint(
  instanceId: string,
  worldX: number,
  worldY: number,
  currentNodes: ReturnType<typeof useSceneStore.getState>["getNodes"] extends () => infer T ? T : never,
  calculateLayoutForFrame: ReturnType<typeof useLayoutStore.getState>["calculateLayoutForFrame"],
): string | null {
  const instanceNode = findNodeById(currentNodes, instanceId);
  if (!instanceNode || instanceNode.type !== "ref") return null;

  const absPos = getNodeAbsolutePositionWithLayout(
    currentNodes,
    instanceId,
    calculateLayoutForFrame,
  );
  if (!absPos) return null;

  const preparedInstance = prepareInstanceNode(
    instanceNode,
    currentNodes,
    calculateLayoutForFrame,
  );
  if (!preparedInstance) return null;

  const localX = worldX - absPos.x;
  const localY = worldY - absPos.y;
  return findDeepestChildAtPosition(preparedInstance.layoutChildren, localX, localY);
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

  let isSpaceHeld = false;

  // Create interaction context
  const context: InteractionContext = {
    canvas,
    screenToWorld: (x: number, y: number) => screenToWorld(x, y),
    isSpaceHeld: () => isSpaceHeld,
  };

  // Create all controllers
  const pan = createPanController(context);
  const transform = createTransformController(context);
  const draw = createDrawController(context);
  const drag = createDragController(context);
  const marquee = createMarqueeController(context);
  const measurement = createMeasurementController(context);

  // --- Pointer handlers ---

  function handlePointerDown(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);

    // Priority 1: Pan (Space+click or middle-mouse)
    if (pan.handlePointerDown(e)) return;

    // Priority 2: Transform (resize handles)
    if (transform.handlePointerDown(e, world)) return;

    // Priority 3: Drawing mode
    if (draw.handlePointerDown(e, world)) return;

    // Priority 4: Drag (label or node)
    if (e.button === 0) {
      const labelHitId = findFrameLabelAtPoint(world.x, world.y);
      if (labelHitId) {
        // Handle label drag separately to ensure proper selection behavior
        const state = useSceneStore.getState();
        const node = state.nodesById[labelHitId];
        if (node) {
          if (e.shiftKey) {
            useSelectionStore.getState().addToSelection(labelHitId);
          } else {
            useSelectionStore.getState().select(labelHitId);
          }

          // Match Konva behavior: modifier clicks are selection gestures, not drag start.
          if (!(e.shiftKey || e.metaKey || e.ctrlKey)) {
            // Start drag from label by creating a custom drag start
            drag.handlePointerDown(e, world, labelHitId);
          }
        }
        return;
      }

      const deepSelect = e.metaKey || e.ctrlKey;
      const hitId = findNodeAtPoint(world.x, world.y, { deepSelect });
      const selectionState = useSelectionStore.getState();
      const currentNodes = useSceneStore.getState().getNodes();
      const calculateLayoutForFrame =
        useLayoutStore.getState().calculateLayoutForFrame;

      // Instance descendant selection (like Konva):
      // - Cmd/Ctrl+click on instance deep-selects descendant
      // - while already in instance context, plain click switches descendant
      if (hitId) {
        const hitNode = findNodeById(currentNodes, hitId);
        const activeInstanceId = selectionState.instanceContext?.instanceId;
        const shouldDeepSelectInInstance =
          (deepSelect && hitNode?.type === "ref") ||
          (!!activeInstanceId && activeInstanceId === hitId);
        if (shouldDeepSelectInInstance) {
          const descendantId = findInstanceDescendantAtWorldPoint(
            hitId,
            world.x,
            world.y,
            currentNodes,
            calculateLayoutForFrame,
          );
          if (descendantId) {
            useSelectionStore.getState().selectDescendant(hitId, descendantId);
            return;
          }
        }
      }

      if (drag.handlePointerDown(e, world, hitId)) return;

      // Priority 5: Marquee selection (background click)
      marquee.handlePointerDown(e, world, hitId);
    }
  }

  function handlePointerMove(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);

    // Handle active interactions
    if (pan.handlePointerMove(e)) return;
    if (draw.handlePointerMove(e, world)) return;
    if (transform.handlePointerMove(e, world)) return;
    if (drag.handlePointerMove(e, world)) return;
    if (marquee.handlePointerMove(e, world)) return;

    // Hover detection
    const hitId = findNodeAtPoint(world.x, world.y, { deepSelect: true });
    const selectionState = useSelectionStore.getState();
    const activeInstanceId = selectionState.instanceContext?.instanceId;
    if (activeInstanceId && hitId === activeInstanceId) {
      // When inside an instance context, resolve descendant under pointer for hover
      const currentNodes = useSceneStore.getState().getNodes();
      const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
      const descendantId = findInstanceDescendantAtWorldPoint(
        activeInstanceId,
        world.x,
        world.y,
        currentNodes,
        calculateLayoutForFrame,
      );
      if (descendantId) {
        useHoverStore.getState().setHoveredNode(descendantId, activeInstanceId);
      } else {
        useHoverStore.getState().setHoveredNode(hitId);
      }
    } else {
      useHoverStore.getState().setHoveredNode(hitId);
    }

    // Measurement (Alt+hover)
    measurement.handlePointerMove(e, world, hitId);

    // Update cursor for transform handles
    const handleHit = hitTestTransformHandle(world.x, world.y);
    if (handleHit) {
      canvas.style.cursor = getResizeCursor(handleHit.corner);
    } else if (!drag.isDragging() && !pan.isPanning()) {
      const { activeTool } = useDrawModeStore.getState();
      canvas.style.cursor = activeTool && activeTool !== "cursor" ? "crosshair" : "";
    }
  }

  function handlePointerUp(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);

    // Handle interaction cleanup in order
    if (pan.handlePointerUp(e)) return;
    if (transform.handlePointerUp(e, world)) return;
    if (draw.handlePointerUp(e, world)) return;
    if (drag.handlePointerUp(e, world)) return;
    if (marquee.handlePointerUp(e, world)) return;
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
      if (selectedNode && selectedNode.type === "ref") {
        const descendantId = findInstanceDescendantAtWorldPoint(
          selectedNode.id,
          world.x,
          world.y,
          currentNodes,
          calculateLayoutForFrame,
        );
        if (descendantId) {
          useSelectionStore.getState().selectDescendant(selectedNode.id, descendantId);
          const descendantNode = findNodeById(
            prepareInstanceNode(selectedNode, currentNodes, calculateLayoutForFrame)?.layoutChildren ?? [],
            descendantId,
          );
          if (descendantNode?.type === "text") {
            useSelectionStore.getState().startDescendantEditing();
          }
        }
        return;
      }
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
            ? prepareFrameNode(selectedNode, calculateLayoutForFrame).layoutChildren
            : selectedNode.children;
        const childId = findDeepestChildAtPosition(hitChildren, localX, localY);
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
    } else if (node.type === "ref") {
      const descendantId = findInstanceDescendantAtWorldPoint(
        hitId,
        world.x,
        world.y,
        currentNodes,
        calculateLayoutForFrame,
      );
      if (descendantId) {
        useSelectionStore.getState().selectDescendant(hitId, descendantId);
        const descendantNode = findNodeById(
          prepareInstanceNode(node, currentNodes, calculateLayoutForFrame)?.layoutChildren ?? [],
          descendantId,
        );
        if (descendantNode?.type === "text") {
          useSelectionStore.getState().startDescendantEditing();
        }
      }
    } else if (node.type === "frame" || node.type === "group") {
      // Enter container (fallback when no selected container context)
      useSelectionStore.getState().enterContainer(hitId);
    }
  }

  function handleWheel(e: WheelEvent): void {
    pan.handleWheel(e);
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
