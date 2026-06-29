import {
  isContainerNode,
  type SceneNode,
  type HistorySnapshot,
} from "@/types/scene";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useUIVisibilityStore } from "@/store/uiVisibilityStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useConnectorStore } from "@/store/connectorStore";
import { useDragStore } from "@/store/dragStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { findNodeById, findParentFrame } from "@/utils/nodeUtils";
import { isTypingTarget } from "./keyboardShortcutUtils";
import { handleArrowKeys, handleEnterEditing } from "./keyboardNavigation";

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
  restoreSnapshot: (snapshot: HistorySnapshot) => void;
  saveHistory: (snapshot: HistorySnapshot) => void;
  startBatch: () => void;
  endBatch: () => void;
  undo: (snapshot: HistorySnapshot) => HistorySnapshot | null;
  redo: (snapshot: HistorySnapshot) => HistorySnapshot | null;
  fitToContent: (nodes: SceneNode[], width: number, height: number) => void;
  toggleTool: (tool: "frame" | "rect" | "ellipse" | "text" | "line" | "polygon" | "embed" | "pencil" | "connector") => void;
  cancelDrawing: () => void;
  clearSelection: () => void;
  copySelection: () => void;
  cutSelection: () => void;
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

    // Shift+V — toggle read-only view mode
    if (e.code === "KeyV" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (isTyping) return;
      e.preventDefault();
      const m = useEditorModeStore.getState();
      if (m.mode === "view") m.exitToEdit();
      else m.enterView();
      return;
    }

    // Cmd/Ctrl+Enter — start present mode
    if ((e.metaKey || e.ctrlKey) && e.code === "Enter") {
      if (isTyping) return;
      e.preventDefault();
      useEditorModeStore.getState().enterPresent();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      if (isTyping) return;
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
      const { enteredContainerId } = useSelectionStore.getState();

      if (enteredContainerId) {
        const container = findNodeById(nodes, enteredContainerId);
        if (container && isContainerNode(container)) {
          const ids = container.children
            .filter((n) => n.visible !== false)
            .map((n) => n.id);
          useSelectionStore.getState().setSelectedIds(ids);
        }
      } else {
        const ids = nodes.filter((n) => n.visible !== false).map((n) => n.id);
        useSelectionStore.getState().setSelectedIds(ids);
      }
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
        toggleTool("polygon");
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
        ids.forEach((id) => deleteNode(id));
        endBatch();
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
      // View mode exits to edit before any selection/draw cancellation.
      if (useEditorModeStore.getState().mode === "view") {
        useEditorModeStore.getState().exitToEdit();
        return;
      }
      // Cancel auto-layout drag animation if in progress
      const dragCancelFn = useDragStore.getState().cancelDrag;
      if (dragCancelFn) {
        dragCancelFn();
        return;
      }

      const drawState = useDrawModeStore.getState();
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
