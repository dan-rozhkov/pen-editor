import type { SceneNode, HistorySnapshot } from "@/types/scene";
import type { BooleanOpKind } from "@/lib/booleanOps";
import { useDrawModeStore } from "@/store/drawModeStore";
import { usePenToolStore } from "@/store/penToolStore";
import { useUIVisibilityStore } from "@/store/uiVisibilityStore";
import { useEditorModeStore, canEditScene } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { useConnectorStore } from "@/store/connectorStore";
import { useDragStore } from "@/store/dragStore";
import { useGuidesStore } from "@/store/guidesStore";
import { useRenderModeStore } from "@/store/renderModeStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { findNodeById, findParentFrame } from "@/utils/nodeUtils";
import { tidyUpNodes } from "@/utils/alignmentUtils";
import { applyNodeUpdates } from "@/utils/applyNodeUpdates";
import { finishPenDraft, cancelPenDraft } from "@/pixi/interaction/penDraftCommit";
import { cancelActiveScale } from "@/pixi/interaction/scaleController";
import { cancelActiveMeasure } from "@/pixi/interaction/measureToolController";
import { enterPathEditMode } from "@/pixi/interaction/pathEditMode";
import { isTypingTarget, selectAllInScope } from "./keyboardShortcutUtils";
import {
  handleArrowKeys,
  handleEnterEditing,
  handleTabNavigation,
} from "./keyboardNavigation";

/**
 * Dependencies the keydown handler needs from the host hook. These mirror the
 * store-mutating callbacks supplied to {@link useCanvasKeyboardShortcuts}, plus
 * the clipboard command handlers created by `createClipboardActions`.
 */
export interface KeyDownHandlerDeps {
  dimensions: { width: number; height: number };
  setIsSpacePressed: (value: boolean) => void;
  setIsPanning: (value: boolean) => void;
  deleteNode: (id: string) => void;
  updateNode: (id: string, updates: Partial<SceneNode>) => void;
  moveNode: (nodeId: string, targetParentId: string, index: number) => void;
  groupNodes: (ids: string[]) => string | null;
  ungroupNodes: (ids: string[]) => string[];
  wrapInAutoLayoutFrame: (ids: string[]) => string | null;
  booleanOperation: (ids: string[], op: BooleanOpKind) => string | null;
  restoreSnapshot: (snapshot: HistorySnapshot) => void;
  saveHistory: (snapshot: HistorySnapshot) => void;
  startBatch: () => void;
  endBatch: () => void;
  undo: (snapshot: HistorySnapshot) => HistorySnapshot | null;
  redo: (snapshot: HistorySnapshot) => HistorySnapshot | null;
  fitToContent: (nodes: SceneNode[], width: number, height: number) => void;
  toggleTool: (tool: "frame" | "rect" | "ellipse" | "text" | "line" | "polygon" | "star" | "embed" | "pencil" | "connector" | "pen" | "scale" | "measure") => void;
  cancelDrawing: () => void;
  clearSelection: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  copyStyleSelection: () => void;
  pasteStyleSelection: () => void;
  copyAsCss: () => void;
  copyAsSvg: () => void;
}

/**
 * Build the canvas keydown handler. Returned as a plain function closed over the
 * supplied deps — no React hooks are used here.
 */
export function createKeyDownHandler(deps: KeyDownHandlerDeps) {
  const {
    dimensions,
    setIsSpacePressed,
    setIsPanning,
    deleteNode,
    updateNode,
    moveNode,
    groupNodes,
    ungroupNodes,
    wrapInAutoLayoutFrame,
    booleanOperation,
    restoreSnapshot,
    saveHistory,
    startBatch,
    endBatch,
    undo,
    redo,
    fitToContent,
    toggleTool,
    cancelDrawing,
    clearSelection,
    copySelection,
    cutSelection,
    copyStyleSelection,
    pasteStyleSelection,
    copyAsCss,
    copyAsSvg,
  } = deps;

  return (e: KeyboardEvent) => {
    const isTyping = isTypingTarget(e);

    // Present mode captures navigation keys before any editing shortcut.
    const modeState = useEditorModeStore.getState();
    if (modeState.mode === "present") {
      if (e.code === "Escape") {
        e.preventDefault();
        modeState.exitToEdit();
        return;
      }
      if (e.code === "ArrowRight" || e.code === "ArrowDown" || e.code === "Space") {
        e.preventDefault();
        modeState.nextFrame();
        return;
      }
      if (e.code === "ArrowLeft" || e.code === "ArrowUp") {
        e.preventDefault();
        modeState.prevFrame();
        return;
      }
      return; // present mode swallows all other keys
    }

    const nodes = useSceneStore.getState().getNodes();

    // Cmd/Ctrl+Enter — start present mode
    if ((e.metaKey || e.ctrlKey) && e.code === "Enter") {
      if (isTyping) return;
      e.preventDefault();
      useEditorModeStore.getState().enterPresent();
      return;
    }

    // Tab / Shift+Tab: move selection to the next/previous sibling node. Purely
    // a selection change (non-mutating), so it's allowed in read-only mode too —
    // handle it before the read-only guard below.
    if (e.code === "Tab") {
      if (isTyping) return;
      if (handleTabNavigation(e)) {
        e.preventDefault();
        return;
      }
    }

    // Read-only (view) mode OR dev (inspect) mode: allow only non-mutating
    // commands and swallow every scene-editing shortcut (delete, nudge, group,
    // grid, cut, edit). This is the single policy point for keyboard editing —
    // keep it here rather than scattering canEditScene()/devModeStore guards
    // across each command below. Dev mode doesn't change `useEditorModeStore`'s
    // `mode` (it's an orthogonal overlay on top of "edit" — see
    // devModeStore.ts), so it's checked separately here.
    //
    // Undo/redo (Cmd+Z / Cmd+Shift+Z) IS allowed in dev mode only, unlike other
    // mutating shortcuts: pinning/removing a measurement in dev mode pushes to the
    // same shared undo history as normal editing (see measurementsStore /
    // keyboardCommands' Delete-in-dev-mode branch below), so blocking undo
    // while inspecting would leave no way to walk that history back. In view mode,
    // undo/redo are never allowed.
    const isDevMode = useDevModeStore.getState().active;
    if (!canEditScene(useEditorModeStore.getState().mode) || isDevMode) {
      if (e.code === "Escape") {
        // Measure tool is dev-mode-only — Escape exits it back to the cursor
        // tool first. This early return otherwise shadows the generic
        // draw-tool Escape handling further down (dev mode keeps `mode` at
        // "edit", so that handler is unreachable while dev mode is active).
        if (isDevMode && useDrawModeStore.getState().activeTool === "measure") {
          e.preventDefault();
          cancelActiveMeasure();
          useDrawModeStore.getState().setActiveTool(null);
          useMeasurementsStore.getState().setSelectedMeasurement(null);
          return;
        }
        // Dev mode: Escape clears the current selection (there's no draw
        // tool/present session to back out of — dev mode itself is only
        // ever exited via Shift+D). View mode keeps the original
        // present-mode-mirroring no-op via exitToEdit().
        if (isDevMode) {
          e.preventDefault();
          useMeasurementsStore.getState().setSelectedMeasurement(null);
          clearSelection();
          return;
        }
        // Mirrors view mode's Escape handling exactly. `mode` is "view", so
        // this is a harmless no-op (presentFrameIds/Index are already empty)
        // rather than an actual mode transition.
        e.preventDefault();
        useEditorModeStore.getState().exitToEdit();
        return;
      }

      // Delete/Backspace in dev mode: remove the selected pinned measurement.
      // This is the ONE mutating key the dev-mode read-only policy allows —
      // it must return here rather than fall through to the generic
      // scene-node deletion below, which must never run while inspecting.
      if (isDevMode && (e.code === "Delete" || e.code === "Backspace")) {
        if (isTyping) return;
        const selectedMeasurementId = useMeasurementsStore.getState().selectedMeasurementId;
        if (selectedMeasurementId) {
          e.preventDefault();
          useMeasurementsStore.getState().removeMeasurement(selectedMeasurementId);
        }
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      const allowed =
        (mod && e.code === "KeyC") || // copy
        (mod && e.shiftKey && (e.code === "KeyC" || e.code === "KeyS")) || // copy as CSS / SVG
        (mod && e.shiftKey && e.code === "KeyO") || // toggle outline mode
        (mod && e.code === "KeyA") || // select all
        (mod && e.code === "Digit0") || // fit to content
        (mod && e.code === "Backslash") || // toggle UI
        (isDevMode && mod && e.code === "KeyZ") || // undo/redo (dev mode only: measurement history)
        e.code === "Space" || // pan
        (e.key === "Enter" && e.shiftKey) || // select parent frame
        (e.shiftKey && !mod && !e.altKey && e.code === "KeyD") || // toggle dev mode
        (e.shiftKey && !mod && !e.altKey && e.code === "KeyM"); // toggle measure tool
      if (!allowed) return;
      // Allowed read-only commands fall through to their handlers below.
    }

    if (e.key === "Enter" && !e.shiftKey) {
      if (isTyping) return;
      // Pen tool: Enter finishes the in-progress draft as an open path.
      if (useDrawModeStore.getState().activeTool === "pen" && usePenToolStore.getState().isDrafting) {
        e.preventDefault();
        finishPenDraft(false);
        return;
      }
      // A single selected path node: Enter enters point-edit mode.
      const { selectedIds: soleSelection, editingNodeId, editingMode } = useSelectionStore.getState();
      if (!editingNodeId && !editingMode && soleSelection.length === 1) {
        const soleNode = findNodeById(nodes, soleSelection[0]);
        if (soleNode?.type === "path") {
          e.preventDefault();
          enterPathEditMode(soleNode.id);
          return;
        }
      }
      if (handleEnterEditing(e, nodes)) return;
    }

    if (e.key === "Enter" && e.shiftKey) {
      if (isTyping) return;
      e.preventDefault();

      const { selectedIds } = useSelectionStore.getState();
      if (selectedIds.length === 1) {
        const parentContext = findParentFrame(nodes, selectedIds[0]);
        if (parentContext.parent) {
          useSelectionStore.getState().select(parentContext.parent.id);
        }
      }
      return;
    }

    // Cmd/Ctrl+Alt+U/S/I/X: Union/Subtract/Intersect/Exclude selected shapes.
    // Cmd/Ctrl+Alt+E: Flatten. Checked before Copy/Cut below (which don't
    // exclude Alt) so these combos aren't shadowed by Cmd+Alt+X == "cut".
    if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey) {
      const opByCode: Record<string, "union" | "subtract" | "intersect" | "exclude" | "flatten"> = {
        KeyU: "union",
        KeyS: "subtract",
        KeyI: "intersect",
        KeyX: "exclude",
        KeyE: "flatten",
      };
      const op = opByCode[e.code];
      if (op) {
        if (isTyping) return;
        e.preventDefault();
        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length >= 2) {
          const resultId = booleanOperation(ids, op);
          if (resultId) useSelectionStore.getState().select(resultId);
        }
        return;
      }
    }

    // Cmd/Ctrl+Alt+T: Tidy up — auto-arrange the selection into a neat
    // row/column/grid with equal spacing (Figma's shortcut for the same
    // command). Checked alongside the other Cmd/Ctrl+Alt combos above.
    if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === "KeyT") {
      if (isTyping) return;
      e.preventDefault();
      const ids = useSelectionStore.getState().selectedIds;
      if (ids.length >= 2) {
        const updates = tidyUpNodes(ids, nodes);
        if (updates.length > 0) applyNodeUpdates(nodes, updates);
      }
      return;
    }

    // Cmd/Ctrl+Opt+C / Cmd/Ctrl+Opt+V: "Copy/paste properties" (Figma-style
    // style clipboard) — checked before the plain Copy/Paste below so Opt
    // doesn't fall through to node copy/paste.
    if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === "KeyC") {
      if (isTyping) return;
      e.preventDefault();
      copyStyleSelection();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === "KeyV") {
      if (isTyping) return;
      e.preventDefault();
      pasteStyleSelection();
      return;
    }

    // Cmd/Ctrl+Shift+C / Cmd/Ctrl+Shift+S: "Copy as CSS" / "Copy as SVG" —
    // Figma-style design-to-code bridge, checked before the plain Copy below
    // so Shift doesn't fall through to node copy/paste or the star tool.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "KeyC") {
      if (isTyping) return;
      e.preventDefault();
      copyAsCss();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "KeyS") {
      if (isTyping) return;
      e.preventDefault();
      copyAsSvg();
      return;
    }

    // Cmd/Ctrl+Shift+O: toggle outline (wireframe) render mode ("O" = Outline).
    // Figma uses Cmd+Shift+3, but on macOS that is the OS screen-capture
    // shortcut and never reaches the browser — Cmd+Shift+O is free of both
    // OS and app conflicts. Non-mutating (view-only), so it's allowed in
    // read-only mode too via the allowlist above.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "KeyO") {
      if (isTyping) return;
      e.preventDefault();
      useRenderModeStore.getState().toggle();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.code === "KeyC") {
      if (isTyping) return;
      e.preventDefault();
      copySelection();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.code === "KeyX") {
      if (isTyping) return;
      e.preventDefault();
      cutSelection();
      return;
    }

    // Cmd/Ctrl+V: Don't handle here — let the paste event fire.
    // All paste logic (internal, SVG) is in handlePaste.

    if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && !e.shiftKey) {
      if (isTyping) return;
      e.preventDefault();
      const snapshot = createSnapshot(useSceneStore.getState());
      const prevSnapshot = undo(snapshot);
      if (prevSnapshot) {
        restoreSnapshot(prevSnapshot);
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && e.shiftKey) {
      if (isTyping) return;
      e.preventDefault();
      const snapshot = createSnapshot(useSceneStore.getState());
      const nextSnapshot = redo(snapshot);
      if (nextSnapshot) {
        restoreSnapshot(nextSnapshot);
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.code === "Backslash") {
      if (isTyping) return;
      e.preventDefault();
      useUIVisibilityStore.getState().toggleUI();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.code === "Digit0") {
      if (isTyping) return;
      e.preventDefault();
      const currentNodes = useSceneStore.getState().getNodes();
      fitToContent(currentNodes, dimensions.width, dimensions.height);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.code === "KeyA") {
      if (isTyping) return;
      e.preventDefault();
      const ids = selectAllInScope(nodes, useSelectionStore.getState());
      if (ids) useSelectionStore.getState().setSelectedIds(ids);
      return;
    }

    if (
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      !e.shiftKey &&
      e.code === "KeyG"
    ) {
      e.preventDefault();
      const ids = useSelectionStore.getState().selectedIds;
      if (ids.length >= 2) {
        const groupId = groupNodes(ids);
        if (groupId) {
          useSelectionStore.getState().select(groupId);
        }
      }
      return;
    }

    if (
      (e.metaKey || e.ctrlKey) &&
      e.shiftKey &&
      !e.altKey &&
      e.code === "KeyG"
    ) {
      e.preventDefault();
      const ids = useSelectionStore.getState().selectedIds;
      if (ids.length >= 1) {
        const childIds = ungroupNodes(ids);
        if (childIds.length > 0) {
          useSelectionStore.getState().setSelectedIds(childIds);
        }
      }
      return;
    }

    // Shift+A: Wrap selection in auto-layout frame
    if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === "KeyA") {
      if (isTyping) return;
      e.preventDefault();
      const ids = useSelectionStore.getState().selectedIds;
      if (ids.length >= 1) {
        const frameId = wrapInAutoLayoutFrame(ids);
        if (frameId) {
          useSelectionStore.getState().select(frameId);
        }
      }
      return;
    }

    // Shift+G: Toggle all layout grids visibility
    if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === "KeyG") {
      if (isTyping) return;
      e.preventDefault();
      const scState = useSceneStore.getState();
      const frameIds: string[] = [];
      for (const id in scState.nodesById) {
        const node = scState.nodesById[id];
        if (node.type === "frame" && node.layoutGrids?.length) {
          frameIds.push(id);
        }
      }
      if (frameIds.length === 0) return;
      // If any grid is visible, hide all; otherwise show all
      const anyVisible = frameIds.some((id) => {
        const node = scState.nodesById[id];
        return node.type === "frame" && node.layoutGrids?.some((g) => g.visible);
      });
      for (const id of frameIds) {
        const node = scState.nodesById[id];
        if (node.type === "frame" && node.layoutGrids) {
          updateNode(id, {
            layoutGrids: node.layoutGrids.map((g) => ({ ...g, visible: !anyVisible })),
          } as Partial<SceneNode>);
        }
      }
      return;
    }

    // Cmd/Ctrl+Shift+BracketLeft / BracketRight ("{" / "}" on a US layout —
    // Shift is what turns the bracket keys into braces, so e.code stays
    // Bracket* rather than switching on e.key): move the selected node one
    // position up/down among its siblings (tree/z-order). LayersPanel renders
    // rootIds/childrenById in *reverse* (last array index = topmost row), and
    // Pixi stacks children in array order (last = on top), so "up" in the
    // panel/canvas means moving to a *higher* array index.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
      if (isTyping) return;
      e.preventDefault();
      const { selectedIds } = useSelectionStore.getState();
      if (selectedIds.length === 1) {
        const id = selectedIds[0];
        const sceneState = useSceneStore.getState();
        const parentId = sceneState.parentById[id] ?? null;
        const siblings = parentId !== null ? (sceneState.childrenById[parentId] ?? []) : sceneState.rootIds;
        const currentIndex = siblings.indexOf(id);
        if (currentIndex !== -1) {
          const delta = e.code === "BracketLeft" ? 1 : -1;
          const newIndex = currentIndex + delta;
          if (newIndex >= 0 && newIndex < siblings.length) {
            sceneState.moveNode(id, parentId, newIndex);
          }
        }
      }
      return;
    }

    // Shift+R: Toggle rulers
    if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === "KeyR") {
      if (isTyping) return;
      e.preventDefault();
      useGuidesStore.getState().toggleShowRulers();
      return;
    }

    // Shift+D: Toggle Dev (inspect) mode. It's the toggle itself, so it must
    // fire whether dev mode is currently on or off — placed above the
    // read-only allowlist's reach (both branches of that `if` fall through to
    // here) and still respects `isTyping` like every other letter shortcut.
    if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === "KeyD") {
      if (isTyping) return;
      e.preventDefault();
      useDevModeStore.getState().toggle();
      return;
    }

    // Shift+M: Toggle the measure tool. Only meaningful in dev (inspect)
    // mode — inert otherwise, so a stray Shift+M in normal editing does
    // nothing (matches the brief: "harmless" outside dev mode).
    if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === "KeyM") {
      if (isTyping) return;
      if (!useDevModeStore.getState().active) return;
      e.preventDefault();
      // Toggling the tool off mid-drag must also kill any in-progress
      // gesture immediately (not just wait for the next pointer event's
      // defensive activeTool re-check in measureToolController).
      cancelActiveMeasure();
      toggleTool("measure");
      return;
    }

    if (!isTyping && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (e.code === "KeyV") {
        e.preventDefault();
        useDrawModeStore.getState().setActiveTool(null);
        return;
      }
      if (e.code === "KeyF") {
        e.preventDefault();
        toggleTool("frame");
        return;
      }
      if (e.code === "KeyR") {
        e.preventDefault();
        toggleTool("rect");
        return;
      }
      if (e.code === "KeyO") {
        e.preventDefault();
        toggleTool("ellipse");
        return;
      }
      if (e.code === "KeyT") {
        e.preventDefault();
        toggleTool("text");
        return;
      }
      if (e.code === "KeyL") {
        e.preventDefault();
        toggleTool("line");
        return;
      }
      if (e.code === "KeyP") {
        e.preventDefault();
        toggleTool("pen");
        return;
      }
      if (e.code === "KeyG") {
        e.preventDefault();
        toggleTool("polygon");
        return;
      }
      if (e.code === "KeyS") {
        e.preventDefault();
        toggleTool("star");
        return;
      }
      if (e.code === "KeyE") {
        e.preventDefault();
        toggleTool("embed");
        return;
      }
      if (e.code === "KeyD") {
        e.preventDefault();
        toggleTool("pencil");
        return;
      }
      if (e.code === "KeyC") {
        e.preventDefault();
        toggleTool("connector");
        return;
      }
      if (e.code === "KeyK") {
        e.preventDefault();
        toggleTool("scale");
        return;
      }
    }

    if (e.code === "Space" && !e.repeat) {
      if (isTyping) return;
      e.preventDefault();
      setIsSpacePressed(true);
      setIsPanning(true);
    }

    if (e.code === "Delete" || e.code === "Backspace") {
      if (isTyping) return;
      e.preventDefault();
      const ids = useSelectionStore.getState().selectedIds;

      if (ids.length > 0) {
        saveHistory(createSnapshot(useSceneStore.getState()));
        startBatch();
        try {
          ids.forEach((id) => deleteNode(id));
        } finally {
          endBatch();
        }
        clearSelection();
      }
    }

    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)
    ) {
      if (isTyping) return;
      if (handleArrowKeys(e, { updateNode, moveNode, saveHistory })) return;
    }

    if (e.code === "Escape") {
      // Cancel an in-progress scale gesture first: revert its live preview
      // without committing history. (The scaleController state lives in the
      // interaction closure, reachable only via this escape hatch.)
      if (cancelActiveScale()) return;

      // Cancel auto-layout drag animation if in progress
      const dragCancelFn = useDragStore.getState().cancelDrag;
      if (dragCancelFn) {
        dragCancelFn();
        return;
      }

      const drawState = useDrawModeStore.getState();
      if (drawState.activeTool === "pen") {
        // Esc finishes an in-progress draft as an open path (like Enter);
        // with nothing drawn yet, it just exits the tool.
        if (usePenToolStore.getState().isDrafting) {
          finishPenDraft(false);
        } else {
          cancelPenDraft();
        }
        return;
      }
      if (drawState.activeTool || drawState.isDrawing) {
        useConnectorStore.getState().cancelConnectorDraw();
        cancelDrawing();
        return;
      }
      if (useSelectionStore.getState().exitContainer()) return;
      clearSelection();
    }
  };
}
