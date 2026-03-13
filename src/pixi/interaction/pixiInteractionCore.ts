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
  getNodeEffectiveSize,
  isDescendantOfFlat,
} from "@/utils/nodeUtils";
import type { InteractionContext } from "./types";
import {
  screenToWorld,
  findCanvasHitTargetAtPoint,
  findNodeAtPoint,
  findFrameLabelAtPoint,
  hitTestTransformHandle,
  getResizeCursor,
} from "./hitTesting";
import { createPanController } from "./panController";
import { createTransformController } from "./transformController";
import { createDrawController } from "./drawController";
import { createDragController } from "./dragController";
import { createMarqueeController } from "./marqueeController";
import { createMeasurementController } from "./measurementController";
import { prepareFrameNode } from "@/utils/instanceUtils";
import { resolveRefToTree, findNodeByPath } from "@/utils/instanceRuntime";
import type { SceneNode, RefNode } from "@/types/scene";

const EMPTY_POINTER_EVENT = {} as PointerEvent;

function getSelectionBoundingBox(
  selectedIds: string[],
  currentNodes: SceneNode[],
  calculateLayoutForFrame: ReturnType<typeof useLayoutStore.getState>["calculateLayoutForFrame"],
): { x: number; y: number; width: number; height: number } | null {
  if (selectedIds.length <= 1) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of selectedIds) {
    const absPos = getNodeAbsolutePositionWithLayout(
      currentNodes,
      id,
      calculateLayoutForFrame,
    );
    const size = getNodeEffectiveSize(currentNodes, id, calculateLayoutForFrame);
    if (!absPos || !size) continue;

    minX = Math.min(minX, absPos.x);
    minY = Math.min(minY, absPos.y);
    maxX = Math.max(maxX, absPos.x + size.width);
    maxY = Math.max(maxY, absPos.y + size.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function isPointInsideBounds(
  point: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number } | null,
): boolean {
  if (!bounds) return false;

  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function resolveDragTargetId(hitId: string | null): string | null {
  if (!hitId) return null;

  const sceneState = useSceneStore.getState();
  const { selectedIds } = useSelectionStore.getState();
  if (selectedIds.length !== 1) return hitId;

  const selectedId = selectedIds[0];
  if (selectedId === hitId) return hitId;

  const selectedNode = sceneState.nodesById[selectedId];
  if (selectedNode?.type !== "group") return hitId;

  return isDescendantOfFlat(sceneState.parentById, selectedId, hitId)
    ? selectedId
    : hitId;
}

/**
 * Set up all pointer interaction handlers on the PixiJS canvas.
 * Returns a cleanup function.
 */
export function setupPixiInteraction(
  app: Application,
  viewport: Container,
  sceneRoot: Container,
): () => void {
  void viewport;
  void sceneRoot;

  const canvas = app.canvas as HTMLCanvasElement;

  let isSpaceHeld = false;
  let hoverRafId: number | null = null;
  let pendingHoverWorld: { x: number; y: number } | null = null;

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

  function runHoverPass(world: { x: number; y: number }): void {
    const hitTarget = findCanvasHitTargetAtPoint(world.x, world.y, { deepSelect: true });
    if (!hitTarget) {
      useHoverStore.getState().clearHovered();
    } else if (hitTarget.kind === "node") {
      useHoverStore.getState().setHoveredNode(hitTarget.nodeId);
    } else {
      useHoverStore
        .getState()
        .setHoveredDescendant(hitTarget.instanceId, hitTarget.descendantPath);
    }

    // Measurement (Alt+hover)
    measurement.handlePointerMove(
      EMPTY_POINTER_EVENT,
      world,
      hitTarget?.kind === "node"
        ? hitTarget.nodeId
        : hitTarget?.kind === "instance-descendant"
          ? hitTarget.instanceId
          : null,
      hitTarget?.kind === "instance-descendant"
        ? { instanceId: hitTarget.instanceId, descendantPath: hitTarget.descendantPath }
        : undefined,
    );

    // Update cursor for transform handles
    const handleHit = hitTestTransformHandle(world.x, world.y);
    if (handleHit) {
      canvas.style.cursor = getResizeCursor(handleHit.corner);
    } else if (!drag.isDragging() && !pan.isPanning()) {
      const { activeTool } = useDrawModeStore.getState();
      canvas.style.cursor = activeTool && activeTool !== "cursor" ? "crosshair" : "";
    }
  }

  function scheduleHoverPass(world: { x: number; y: number }): void {
    pendingHoverWorld = world;
    if (hoverRafId !== null) return;
    hoverRafId = requestAnimationFrame(() => {
      hoverRafId = null;
      const latest = pendingHoverWorld;
      pendingHoverWorld = null;
      if (!latest) return;
      runHoverPass(latest);
    });
  }

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
      const hitTarget = findCanvasHitTargetAtPoint(world.x, world.y, { deepSelect });
      const hitId = hitTarget?.kind === "node" ? hitTarget.nodeId : null;
      if (hitTarget?.kind === "instance-descendant") {
        useSelectionStore
          .getState()
          .selectDescendant(hitTarget.instanceId, hitTarget.descendantPath);
        return;
      }

      const dragHitId = resolveDragTargetId(hitId);
      const selectionState = useSelectionStore.getState();
      const currentNodes = useSceneStore.getState().getNodes();
      const calculateLayoutForFrame =
        useLayoutStore.getState().calculateLayoutForFrame;

      const selectionBounds = getSelectionBoundingBox(
        selectionState.selectedIds,
        currentNodes,
        calculateLayoutForFrame,
      );
      if (!hitId && isPointInsideBounds(world, selectionBounds)) {
        if (drag.handlePointerDown(e, world, null, selectionState.selectedIds)) return;
      }

      if (drag.handlePointerDown(e, world, dragHitId)) return;

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

    // Hover/hit-test path is expensive on big scenes; run at most once per frame.
    scheduleHoverPass(world);
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
      useSelectionStore.getState().startEditing(frameLabelHitId, 'name');
      return;
    }

    // Handle double-click within an entered ref instance
    const selState = useSelectionStore.getState();
    if (selState.instanceContext) {
      const scState = useSceneStore.getState();
      const refNode = scState.nodesById[selState.instanceContext.instanceId];
      if (refNode?.type === "ref") {
        const resolved = resolveRefToTree(refNode as RefNode, scState.nodesById, scState.childrenById);
        if (resolved) {
          const descNode = findNodeByPath(resolved.children, selState.instanceContext.descendantPath, scState.nodesById, scState.childrenById);
          if (descNode?.type === "text") {
            // Enter text editing for descendant
            useSelectionStore.getState().startEditing(selState.instanceContext.descendantPath);
            return;
          }
          if (descNode && (descNode.type === "frame" || descNode.type === "group")) {
            // Drill deeper within instance
            useSelectionStore.getState().enterInstanceDescendant(selState.instanceContext.descendantPath);
            // Re-hit-test now that enteredInstanceDescendantPath is updated
            const hitTarget = findCanvasHitTargetAtPoint(world.x, world.y);
            if (hitTarget?.kind === "instance-descendant") {
              useSelectionStore.getState().selectDescendant(hitTarget.instanceId, hitTarget.descendantPath);

              // Start inline editing if the deeper descendant is text/embed
              const deepDesc = findNodeByPath(resolved.children, hitTarget.descendantPath, scState.nodesById, scState.childrenById);
              if (deepDesc?.type === "text") {
                useSelectionStore.getState().startEditing(hitTarget.descendantPath);
              } else if (deepDesc?.type === "embed") {
                useSelectionStore.getState().startEditing(hitTarget.descendantPath, "embed");
              }
            }
            return;
          }
        }
      }
    }

    // Match Konva behavior: drill down from currently selected container.
    if (currentSelectedIds.length === 1) {
      const selectedNode = findNodeById(currentNodes, currentSelectedIds[0]);
      if (selectedNode && selectedNode.type === "ref") {
        useSelectionStore.getState().enterContainer(selectedNode.id);
        // Hit test to find which first-level child was hit
        const hitTarget = findCanvasHitTargetAtPoint(world.x, world.y);
        if (hitTarget?.kind === "instance-descendant") {
          useSelectionStore.getState().selectDescendant(hitTarget.instanceId, hitTarget.descendantPath);

          // Start inline editing immediately if the descendant is text/embed
          const scState = useSceneStore.getState();
          const resolved = resolveRefToTree(selectedNode as RefNode, scState.nodesById, scState.childrenById);
          if (resolved) {
            const descNode = findNodeByPath(resolved.children, hitTarget.descendantPath, scState.nodesById, scState.childrenById);
            if (descNode?.type === "text") {
              useSelectionStore.getState().startEditing(hitTarget.descendantPath);
            } else if (descNode?.type === "embed") {
              useSelectionStore.getState().startEditing(hitTarget.descendantPath, "embed");
            }
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

          // Start inline editing immediately if the deepest child is text/embed
          const childNode = useSceneStore.getState().nodesById[childId];
          if (childNode?.type === "text") {
            useSelectionStore.getState().startEditing(childId);
          } else if (childNode?.type === "embed") {
            useSelectionStore.getState().startEditing(childId, "embed");
          }
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
    } else if (node.type === "embed") {
      useSelectionStore.getState().startEditing(hitId, 'embed');
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
    if (hoverRafId !== null) {
      cancelAnimationFrame(hoverRafId);
      hoverRafId = null;
    }
    pendingHoverWorld = null;
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
