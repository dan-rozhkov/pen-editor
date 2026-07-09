import { useEffect } from "react";
import type { SceneNode, HistorySnapshot } from "@/types/scene";
import type { BooleanOpKind } from "@/lib/booleanOps";
import { createClipboardActions } from "./clipboardActions";
import { createStyleClipboardActions } from "./styleClipboardActions";
import { createKeyDownHandler } from "./keyboardCommands";
import { copyAsCss, copyAsSvg } from "./copyAsActions";

interface CanvasKeyboardShortcutsParams {
  copiedNodes: SceneNode[];
  dimensions: { width: number; height: number };
  isMiddleMouseDown: boolean;
  setIsSpacePressed: (value: boolean) => void;
  setIsPanning: (value: boolean) => void;
  addNode: (node: SceneNode) => void;
  addChildToFrame: (frameId: string, child: SceneNode) => void;
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
  toggleTool: (tool: "frame" | "rect" | "ellipse" | "text" | "line" | "polygon" | "star" | "embed" | "pencil" | "connector" | "pen" | "scale") => void;
  cancelDrawing: () => void;
  clearSelection: () => void;
  copyNodes: (nodes: SceneNode[]) => void;
}

export function useCanvasKeyboardShortcuts({
  copiedNodes,
  dimensions,
  isMiddleMouseDown,
  setIsSpacePressed,
  setIsPanning,
  addNode,
  addChildToFrame,
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
  copyNodes,
}: CanvasKeyboardShortcutsParams) {
  useEffect(() => {
    const {
      copySelection,
      cutSelection,
      pasteFromInternalClipboard,
      handlePaste,
    } = createClipboardActions({
      dimensions,
      addNode,
      addChildToFrame,
      deleteNode,
      saveHistory,
      startBatch,
      endBatch,
      clearSelection,
      copyNodes,
    });

    const { copyStyleSelection, pasteStyleSelection } = createStyleClipboardActions({
      updateNode,
      saveHistory,
      startBatch,
      endBatch,
    });

    const handleKeyDown = createKeyDownHandler({
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
    });

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
        if (!isMiddleMouseDown) {
          setIsPanning(false);
        }
      }
    };

    const handleMenuCopy = () => {
      copySelection();
    };

    const handleMenuCut = () => {
      cutSelection();
    };

    const handleMenuPaste = () => {
      pasteFromInternalClipboard();
    };

    const handleMenuCopyStyle = () => {
      copyStyleSelection();
    };

    const handleMenuPasteStyle = () => {
      pasteStyleSelection();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("paste", handlePaste);
    window.addEventListener("pen-editor:copy", handleMenuCopy);
    window.addEventListener("pen-editor:cut", handleMenuCut);
    window.addEventListener("pen-editor:paste", handleMenuPaste);
    window.addEventListener("pen-editor:copy-style", handleMenuCopyStyle);
    window.addEventListener("pen-editor:paste-style", handleMenuPasteStyle);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("paste", handlePaste);
      window.removeEventListener("pen-editor:copy", handleMenuCopy);
      window.removeEventListener("pen-editor:cut", handleMenuCut);
      window.removeEventListener("pen-editor:paste", handleMenuPaste);
      window.removeEventListener("pen-editor:copy-style", handleMenuCopyStyle);
      window.removeEventListener("pen-editor:paste-style", handleMenuPasteStyle);
    };
  }, [
    addChildToFrame,
    addNode,
    booleanOperation,
    cancelDrawing,
    clearSelection,
    copiedNodes,
    copyNodes,
    deleteNode,
    dimensions,
    endBatch,
    fitToContent,
    groupNodes,
    isMiddleMouseDown,
    moveNode,
    redo,
    restoreSnapshot,
    saveHistory,
    setIsPanning,
    setIsSpacePressed,
    startBatch,
    toggleTool,
    undo,
    ungroupNodes,
    updateNode,
    wrapInAutoLayoutFrame,
  ]);
}
