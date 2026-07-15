import { Application, Container } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHoverStore, worldMouse } from "@/store/hoverStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useViewportStore } from "@/store/viewportStore";
import {
  useEditorModeStore,
  canEditScene,
  canInteractCanvas,
} from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import {
  findNodeById,
  getNodeAbsolutePositionWithLayout,
  getNodeEffectiveSize,
  isDescendantOfFlat,
} from "@/utils/nodeUtils";
import { resolveDrillChild } from "./drillDown";
import type { InteractionContext } from "./types";
import {
  screenToWorld,
  findCanvasHitTargetAtPoint,
  findNodeAtPoint,
  findFrameLabelAtPoint,
  hitTestTransformHandle,
  getResizeCursor,
} from "./hitTesting";
import { createPanController, wheelDeltaScale } from "./panController";
import { computePresentScrollRange, clampPresentScrollY } from "./presentScroll";
import { calculateNodesBounds } from "@/utils/viewportUtils";
import { createTouchController } from "./touchController";
import { createTransformController } from "./transformController";
import { createScaleController } from "./scaleController";
import { createDrawController } from "./drawController";
import { createPencilController } from "./pencilController";
import { createPenController } from "./penController";
import { createTextPathController } from "./textPathController";
import { createPathEditController } from "./pathEditController";
import { enterPathEditMode } from "./pathEditMode";
import { createConnectorController } from "./connectorController";
import { createDragController, DRAG_CLICK_THRESHOLD } from "./dragController";
import { createMarqueeController } from "./marqueeController";
import { createMeasurementController } from "./measurementController";
import { createMeasureToolController } from "./measureToolController";
import { resolveRefToTree, findNodeByPath } from "@/utils/instanceRuntime";
import type { SceneNode, RefNode, TextNode } from "@/types/scene";
import { resolveTextHandleReset } from "./textResize";
import { findSlotContext } from "@/utils/componentUtils";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import { createSnapshot } from "@/store/sceneStore";

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

  // Memoizes the active present-mode slide's world bounds so
  // handlePresentWheel doesn't re-walk the frame's entire subtree on every
  // wheel event (~120Hz during trackpad inertia). Present mode is read-only
  // (canEditScene is false), so a frame's own geometry can't change mid
  // session — keyed on the `presentFrameIds` array identity (a fresh array
  // per `enterPresent()` call) plus `frameId` so a later present session
  // (even of the same frame, potentially edited in between) recomputes.
  let presentWheelBoundsCache: {
    framesRef: string[];
    frameId: string;
    bounds: ReturnType<typeof calculateNodesBounds>;
  } | null = null;

  // Descendant drag state (for dragging nodes inside slot overrides)
  let descendantDrag: {
    instanceId: string;
    descendantPath: string;
    slotPath: string;
    relativePath: string;
    startWorldX: number;
    startWorldY: number;
    startNodeX: number;
    startNodeY: number;
    hasMoved: boolean;
  } | null = null;

  // Create interaction context
  const context: InteractionContext = {
    canvas,
    screenToWorld: (x: number, y: number) => screenToWorld(x, y),
    isSpaceHeld: () => isSpaceHeld,
  };

  // Create all controllers
  const pan = createPanController(context);
  const touch = createTouchController(context);

  // Last real pointer event, used to release an in-flight single-finger
  // interaction the moment a two-finger gesture takes over.
  let lastPointerEvent: PointerEvent | null = null;
  const transform = createTransformController(context);
  const scaleTool = createScaleController(context);
  const draw = createDrawController(context);
  const pencil = createPencilController(context);
  const pen = createPenController(context);
  const textPathTool = createTextPathController(context);
  const pathEdit = createPathEditController(context);
  const connector = createConnectorController(context);
  const drag = createDragController(context);
  const marquee = createMarqueeController(context);
  const measurement = createMeasurementController(context);
  const measureTool = createMeasureToolController(context);

  // --- Pointer handlers ---

  function runHoverPass(world: { x: number; y: number }): void {
    const labelHitId = findFrameLabelAtPoint(world.x, world.y);
    const hitTarget = labelHitId
      ? ({ kind: "node", nodeId: labelHitId } as const)
      : findCanvasHitTargetAtPoint(world.x, world.y, { deepSelect: true });
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
      // The scale tool only acts on resize handles (handled above); off a
      // handle it should show the default arrow, not a "draw" crosshair.
      canvas.style.cursor =
        activeTool && activeTool !== "cursor" && activeTool !== "scale" ? "crosshair" : "";
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
    lastPointerEvent = e;
    // A two-finger touch gesture (pan/zoom) owns the canvas — ignore the
    // per-finger pointer events it also emits.
    if (touch.isGesturing()) return;
    const mode = useEditorModeStore.getState().mode;
    // Present mode locks the canvas entirely.
    if (!canInteractCanvas(mode)) return;
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);

    // Priority 1: Pan (Space+click or middle-mouse) — allowed in edit and view.
    if (pan.handlePointerDown(e)) return;

    // Priority 1.5: Measure tool (Shift+M) — self-gates on activeTool ===
    // "measure" (mirrors drawController's own activeTool gate), so this is a
    // no-op whenever the tool isn't active. Placed ahead of the scene-editing
    // and drag/marquee controllers below because pinning/selecting a
    // measurement must never fall through into selection or a drag.
    if (measureTool.handlePointerDown(e, world)) return;

    // Priorities 2-3: scene-editing controllers only run in edit mode.
    // Dev mode (inspect) is belt-and-braces excluded here too — the active
    // draw/edit tool is already force-exited on entry (devModeStore.setActive),
    // but a stray in-flight gesture (e.g. path-edit still active from the
    // instant before) must not mutate the scene while inspecting.
    if (canEditScene(mode) && !useDevModeStore.getState().active) {
      // Path point-edit mode: anchors/handles take priority over the resize
      // handles of the (still-selected) node underneath them. A click that
      // misses every anchor/handle exits edit mode and falls through to
      // normal selection below (e.g. clicking away commits the edit).
      if (pathEdit.isActive()) {
        if (pathEdit.handlePointerDown(e, world)) return;
        useSelectionStore.getState().stopEditing();
      }
      // Scale tool (K): same handles as resize, but a proportional
      // whole-subtree scale — takes priority over the plain resize while active.
      if (scaleTool.handlePointerDown(e, world)) return;
      // Transform (resize handles)
      if (transform.handlePointerDown(e, world)) return;
      // Drawing mode (pencil/pen first, then connector, then standard draw)
      if (pencil.handlePointerDown(e, world)) return;
      if (pen.handlePointerDown(e, world)) return;
      if (textPathTool.handlePointerDown(e, world)) return;
      if (connector.handlePointerDown(e, world)) return;
      if (draw.handlePointerDown(e, world)) return;
    }

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
          // Dev mode allows the selection above (inspection needs it) but never
          // the drag that would follow it.
          if (!(e.shiftKey || e.metaKey || e.ctrlKey) && !useDevModeStore.getState().active) {
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

        // Check if this descendant is inside a replaced slot — allow drag (edit only,
        // never in dev/inspect mode).
        if (!e.metaKey && !e.ctrlKey && canEditScene(mode) && !useDevModeStore.getState().active) {
          const scState = useSceneStore.getState();
          const inst = scState.nodesById[hitTarget.instanceId] as RefNode | undefined;
          if (inst?.type === "ref") {
            const sc = findSlotContext(hitTarget.descendantPath, inst.overrides);
            if (sc) {
              const resolved = resolveRefToTree(inst, scState.nodesById, scState.childrenById);
              if (resolved) {
                const descNode = findNodeByPath(resolved.children, hitTarget.descendantPath, scState.nodesById, scState.childrenById);
                if (descNode) {
                  descendantDrag = {
                    instanceId: hitTarget.instanceId,
                    descendantPath: hitTarget.descendantPath,
                    slotPath: sc.slotPath,
                    relativePath: sc.relativePath,
                    startWorldX: world.x,
                    startWorldY: world.y,
                    startNodeX: descNode.x,
                    startNodeY: descNode.y,
                    hasMoved: false,
                  };
                }
              }
            }
          }
        }
        return;
      }

      const dragHitId = resolveDragTargetId(hitId);
      const selectionState = useSelectionStore.getState();
      const currentNodes = useSceneStore.getState().getNodes();
      const calculateLayoutForFrame =
        useLayoutStore.getState().calculateLayoutForFrame;

      // Dev/inspect mode must still select on a plain node click — selection
      // for this path happens inside drag.handlePointerDown itself, so it
      // cannot be skipped here. dragController's own dev-mode check (see
      // canEditScene/devMode guard in handlePointerDown) selects and returns
      // true before ever arming a drag.
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
    lastPointerEvent = e;
    if (touch.isGesturing()) return;
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);

    // Handle descendant drag (slot child). Belt-and-braces: descendantDrag is
    // only ever set in handlePointerDown, which already excludes dev mode, but
    // an in-flight drag started just before Shift+D toggled dev mode on must
    // not keep mutating the scene either.
    if (descendantDrag && !useDevModeStore.getState().active) {
      const dx = world.x - descendantDrag.startWorldX;
      const dy = world.y - descendantDrag.startWorldY;
      if (
        !descendantDrag.hasMoved &&
        Math.abs(dx) < DRAG_CLICK_THRESHOLD &&
        Math.abs(dy) < DRAG_CLICK_THRESHOLD
      ) {
        return;
      }
      if (!descendantDrag.hasMoved) {
        descendantDrag.hasMoved = true;
      }
      const newX = Math.round(descendantDrag.startNodeX + dx);
      const newY = Math.round(descendantDrag.startNodeY + dy);
      useSceneStore.getState().updateSlotChildWithoutHistory(
        descendantDrag.instanceId,
        descendantDrag.slotPath,
        descendantDrag.relativePath,
        { x: newX, y: newY },
      );
      return;
    }

    // Handle active interactions
    if (pan.handlePointerMove(e)) return;
    if (measureTool.handlePointerMove(e, world)) return;
    if (pathEdit.handlePointerMove(e, world)) return;
    if (pencil.handlePointerMove(e, world)) return;
    if (pen.handlePointerMove(e, world)) return;
    if (textPathTool.handlePointerMove(e, world)) return;
    if (connector.handlePointerMove(e, world)) return;
    if (draw.handlePointerMove(e, world)) return;
    if (scaleTool.handlePointerMove(e, world)) return;
    if (transform.handlePointerMove(e, world)) return;
    if (drag.handlePointerMove(e, world)) return;
    if (marquee.handlePointerMove(e, world)) return;

    // Track world mouse for spacing overlay hit-testing
    worldMouse.x = world.x;
    worldMouse.y = world.y;

    // Phase 2: Skip expensive hover/hit-test pass during active zoom animation.
    // The next pointermove after zoom completes will restore the correct hover state.
    if (useViewportStore.getState().animationFrameId !== null) return;

    // View/present modes are read-only — never show a hover highlight. Dev
    // (inspect) mode does NOT change `mode` (it's an orthogonal overlay on
    // top of "edit"), so canEditScene stays true and this branch is skipped —
    // the hover pass below keeps running, which dev mode needs to drive its
    // measurement/inspection overlay.
    if (!canEditScene(useEditorModeStore.getState().mode)) {
      useHoverStore.getState().clearHovered();
      return;
    }

    // Hover/hit-test path is expensive on big scenes; run at most once per frame.
    scheduleHoverPass(world);
  }

  function handlePointerUp(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);

    // Finalize descendant drag
    if (descendantDrag) {
      if (descendantDrag.hasMoved) {
        // Save history by re-applying current state with history
        const state = useSceneStore.getState();
        const inst = state.nodesById[descendantDrag.instanceId] as RefNode | undefined;
        if (inst?.type === "ref") {
          const override = inst.overrides?.[descendantDrag.slotPath];
          if (override?.kind === "replace") {
            // Save history then re-set to current (position already updated via WithoutHistory)
            saveHistory(createSnapshot(state));
            useSceneStore.setState({ nodesById: { ...state.nodesById }, _cachedTree: null });
          }
        }
      }
      descendantDrag = null;
      return;
    }

    // Handle interaction cleanup in order
    if (pan.handlePointerUp(e)) return;
    if (measureTool.handlePointerUp(e, world)) return;
    if (pathEdit.handlePointerUp(e, world)) return;
    if (scaleTool.handlePointerUp(e, world)) return;
    if (transform.handlePointerUp(e, world)) return;
    if (pencil.handlePointerUp(e, world)) return;
    if (pen.handlePointerUp(e, world)) return;
    if (connector.handlePointerUp(e, world)) return;
    if (draw.handlePointerUp(e, world)) return;
    if (drag.handlePointerUp(e, world)) return;
    if (marquee.handlePointerUp(e, world)) return;
  }

  function handleDblClick(e: MouseEvent): void {
    // Dev (inspect) mode blocks text-edit/drill-down entirely — checked first
    // since `mode` itself stays "edit" while dev mode is active (canEditScene
    // alone wouldn't catch it).
    if (useDevModeStore.getState().active) return;
    // Double-click only starts inline editing (text/name/embed) — disabled
    // outside edit mode so view/present stay read-only.
    if (!canEditScene(useEditorModeStore.getState().mode)) return;
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);

    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const currentSelectedIds = useSelectionStore.getState().selectedIds;
    const currentNodes = useSceneStore.getState().getNodes();

    // Double-clicking a transform handle of a text node resets its sizing mode
    // (side → auto-width, bottom/top → auto-height, corner → auto-width). The
    // mode change runs through updateNode → syncTextDimensions to snap dims.
    const handleHit = hitTestTransformHandle(world.x, world.y);
    if (handleHit && !handleHit.slotContext) {
      const hitNode = useSceneStore.getState().nodesById[handleHit.nodeId] as
        | TextNode
        | undefined;
      if (hitNode?.type === "text") {
        const nextMode = resolveTextHandleReset(handleHit.corner);
        if (nextMode) {
          useSceneStore.getState().updateNode(handleHit.nodeId, {
            textWidthMode: nextMode,
          });
          return;
        }
      }
    }

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
          if (descNode && (descNode.type === "frame" || descNode.type === "group" || descNode.type === "ref")) {
            // Drill deeper within instance (frames, groups, and nested refs)
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
        const childId = resolveDrillChild(
          selectedNode,
          world.x,
          world.y,
          currentNodes,
          calculateLayoutForFrame,
        );
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
    } else if (node.type === "path") {
      enterPathEditMode(hitId);
    } else if (node.type === "embed") {
      useSelectionStore.getState().setActiveEmbed(hitId);
    } else if (node.type === "frame" || node.type === "group") {
      // Enter container (fallback when no selected container context)
      useSelectionStore.getState().enterContainer(hitId);
      const container = findNodeById(state.getNodes(), hitId);
      if (container && (container.type === "frame" || container.type === "group")) {
        const childId = resolveDrillChild(
          container,
          world.x,
          world.y,
          state.getNodes(),
          calculateLayoutForFrame,
        );
        if (childId) {
          useSelectionStore.getState().select(childId);
        }
      }
    }
  }

  // Play/Present narrowly re-opens wheel/trackpad input for vertical-only
  // scrolling of a slide taller than the screen (see presentScroll.ts for the
  // clamp math). Zoom, horizontal pan, and everything else stay locked.
  function handlePresentWheel(e: WheelEvent): void {
    const modeState = useEditorModeStore.getState();
    const frameId = modeState.presentFrameIds[modeState.presentIndex];
    if (!frameId) return;

    let bounds: ReturnType<typeof calculateNodesBounds>;
    if (
      presentWheelBoundsCache &&
      presentWheelBoundsCache.framesRef === modeState.presentFrameIds &&
      presentWheelBoundsCache.frameId === frameId
    ) {
      bounds = presentWheelBoundsCache.bounds;
    } else {
      const nodes = useSceneStore.getState().getNodes();
      const frame = nodes.find((n) => n.id === frameId);
      if (!frame) return;
      bounds = calculateNodesBounds([frame]);
      presentWheelBoundsCache = { framesRef: modeState.presentFrameIds, frameId, bounds };
    }
    if (bounds.isEmpty) return;

    const vs = useViewportStore.getState();
    const range = computePresentScrollRange(
      bounds.minY,
      bounds.maxY - bounds.minY,
      vs.scale,
      window.innerHeight,
    );
    if (!range) return; // slide fits the screen — stays centered, no scroll

    e.preventDefault();
    const deltaY = e.deltaY * wheelDeltaScale(e);
    const newY = clampPresentScrollY(vs.y - deltaY, range);
    vs.setPosition(vs.x, newY);
  }

  function handleWheel(e: WheelEvent): void {
    const mode = useEditorModeStore.getState().mode;
    if (mode === "present") {
      handlePresentWheel(e);
      return;
    }
    if (!canInteractCanvas(mode)) return;
    pan.handleWheel(e);
  }

  function handleTouchStart(e: TouchEvent): void {
    // Present mode locks the canvas — block touch pan/zoom gestures too.
    if (!canInteractCanvas(useEditorModeStore.getState().mode)) return;
    const wasGesturing = touch.isGesturing();
    if (touch.handleTouchStart(e) && !wasGesturing && lastPointerEvent) {
      // The first finger may have started a drag/marquee before the second
      // landed — release it so it doesn't commit while we pan/zoom.
      handlePointerUp(lastPointerEvent);
    }
  }

  function handleTouchMove(e: TouchEvent): void {
    touch.handleTouchMove(e);
  }

  function handleTouchEnd(e: TouchEvent): void {
    touch.handleTouchEnd(e);
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

  // Stop the browser from claiming touch gestures (page scroll / pinch-zoom)
  // so two-finger pan/zoom reaches our handlers on iPad and phones.
  canvas.style.touchAction = "none";

  canvas.addEventListener("wheel", handleWheel, { passive: false });
  // Touch listeners must be non-passive so preventDefault can suppress the
  // browser's native scroll/zoom during a two-finger gesture.
  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  canvas.addEventListener("touchend", handleTouchEnd);
  canvas.addEventListener("touchcancel", handleTouchEnd);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  // Treat cancelled pointers (touch scroll/pinch, stylus loss, OS interrupts)
  // like pointerup — otherwise drag/transform state gets stuck.
  canvas.addEventListener("pointercancel", handlePointerUp);
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
    pan.destroy();
    touch.destroy();
    canvas.removeEventListener("wheel", handleWheel);
    canvas.removeEventListener("touchstart", handleTouchStart);
    canvas.removeEventListener("touchmove", handleTouchMove);
    canvas.removeEventListener("touchend", handleTouchEnd);
    canvas.removeEventListener("touchcancel", handleTouchEnd);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointercancel", handlePointerUp);
    canvas.removeEventListener("dblclick", handleDblClick);
    canvas.removeEventListener("contextmenu", handleContextMenu);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
  };
}
