import { useEffect } from "react";
import { isContainerNode, type SceneNode, type HistorySnapshot } from "@/types/scene";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useUIVisibilityStore } from "@/store/uiVisibilityStore";
import { useClipboardStore } from "@/store/clipboardStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { cloneNodeWithNewId } from "@/utils/cloneNode";
import {
  findNodeById,
  findParentFrame,
} from "@/utils/nodeUtils";
import { resolveRefToTree, findNodeByPath } from "@/utils/instanceRuntime";
import type { RefNode } from "@/types/scene";
import { parseSvgToNodes } from "@/utils/svgUtils";
import {
  applyImageImportPlans,
  createImageImportPlan,
  type ImageImportPlan,
  setImportedSelection,
} from "./imageImport";

const INTERNAL_CLIPBOARD_PRIORITY_MS = 5000;

interface CanvasKeyboardShortcutsParams {
  nodes: SceneNode[];
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
  restoreSnapshot: (snapshot: HistorySnapshot) => void;
  saveHistory: (snapshot: HistorySnapshot) => void;
  startBatch: () => void;
  endBatch: () => void;
  undo: (snapshot: HistorySnapshot) => HistorySnapshot | null;
  redo: (snapshot: HistorySnapshot) => HistorySnapshot | null;
  fitToContent: (nodes: SceneNode[], width: number, height: number) => void;
  toggleTool: (tool: "frame" | "rect" | "ellipse" | "text" | "line" | "polygon" | "embed") => void;
  cancelDrawing: () => void;
  clearSelection: () => void;
  copyNodes: (nodes: SceneNode[]) => void;
}

function isTypingTarget(event: KeyboardEvent | ClipboardEvent): boolean {
  const isEditable = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    );
  };

  if (isEditable(event.target)) return true;

  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const target of path) {
    if (isEditable(target)) return true;
  }

  return false;
}

function getViewportCenter(dimensions: { width: number; height: number }): {
  x: number;
  y: number;
} {
  const { x, y, scale } = useViewportStore.getState();
  return {
    x: (-x + dimensions.width / 2) / scale,
    y: (-y + dimensions.height / 2) / scale,
  };
}

function resolvePasteTargetContainerId(
  nodes: SceneNode[],
  selectionState: Pick<
    ReturnType<typeof useSelectionStore.getState>,
    "enteredContainerId" | "selectedIds"
  >,
): string | null {
  if (selectionState.enteredContainerId) {
    const enteredNode = findNodeById(nodes, selectionState.enteredContainerId);
    if (enteredNode && isContainerNode(enteredNode)) {
      return enteredNode.id;
    }
  }

  if (selectionState.selectedIds.length === 1) {
    const selectedNode = findNodeById(nodes, selectionState.selectedIds[0]);
    if (selectedNode && isContainerNode(selectedNode)) {
      return selectedNode.id;
    }
  }

  return null;
}

export function useCanvasKeyboardShortcuts({
  nodes,
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
    const pasteInternalNodes = (sourceNodes: SceneNode[]): void => {
      const clonedNodes = sourceNodes.map((node) => cloneNodeWithNewId(node));
      const selectionState = useSelectionStore.getState();
      const targetContainerId = resolvePasteTargetContainerId(nodes, selectionState);

      saveHistory(createSnapshot(useSceneStore.getState()));
      startBatch();
      for (const clonedNode of clonedNodes) {
        if (targetContainerId) {
          clonedNode.x = 20;
          clonedNode.y = 20;
          addChildToFrame(targetContainerId, clonedNode);
        } else {
          addNode(clonedNode);
        }
      }
      endBatch();

      setImportedSelection(clonedNodes.map((node) => node.id));
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const isTyping = isTypingTarget(e);

      if (e.key === "Enter" && !e.shiftKey) {
        if (isTyping) return;
        const { selectedIds, editingNodeId, editingMode, instanceContext } =
          useSelectionStore.getState();

        if (!editingNodeId && !editingMode && selectedIds.length === 1) {
          // Handle instance descendant text editing
          if (instanceContext) {
            const scState = useSceneStore.getState();
            const refNode = scState.nodesById[instanceContext.instanceId];
            if (refNode?.type === "ref") {
              const resolved = resolveRefToTree(refNode as RefNode, scState.nodesById, scState.childrenById);
              if (resolved) {
                const descNode = findNodeByPath(resolved.children, instanceContext.descendantPath, scState.nodesById, scState.childrenById);
                if (descNode?.type === "text") {
                  e.preventDefault();
                  useSelectionStore.getState().startEditing(instanceContext.descendantPath);
                  return;
                } else if (descNode?.type === "embed") {
                  e.preventDefault();
                  useSelectionStore.getState().startEditing(instanceContext.descendantPath, "embed");
                  return;
                }
              }
            }
          }

          const selectedNode = findNodeById(nodes, selectedIds[0]);
          if (selectedNode?.type === "text") {
            e.preventDefault();
            useSelectionStore.getState().startEditing(selectedNode.id);
            return;
          }
        }
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
        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length > 0) {
          const nodesToCopy = ids
            .map((id) => findNodeById(nodes, id))
            .filter((n): n is SceneNode => n != null);
          if (nodesToCopy.length > 0) {
            copyNodes(nodesToCopy);
          }
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.code === "KeyX") {
        if (isTyping) return;
        e.preventDefault();
        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length > 0) {
          const nodesToCut = ids
            .map((id) => findNodeById(nodes, id))
            .filter((n): n is SceneNode => n != null);
          if (nodesToCut.length > 0) {
            copyNodes(nodesToCut);
            saveHistory(createSnapshot(useSceneStore.getState()));
            for (const id of ids) {
              deleteNode(id);
            }
            clearSelection();
          }
        }
        return;
      }

      // Cmd/Ctrl+V: Don't handle here — let the paste event fire.
      // All paste logic (internal, SVG) is in handlePaste.

      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && !e.shiftKey) {
        e.preventDefault();
        const snapshot = createSnapshot(useSceneStore.getState());
        const prevSnapshot = undo(snapshot);
        if (prevSnapshot) {
          restoreSnapshot(prevSnapshot);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && e.shiftKey) {
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

        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length === 0) return;

        const currentNodes = useSceneStore.getState().getNodes();

        const nodesOutsideAutoLayout: string[] = [];
        const nodesInsideAutoLayout: string[] = [];

        for (const id of ids) {
          const parentContext = findParentFrame(currentNodes, id);
          if (parentContext.isInsideAutoLayout) {
            nodesInsideAutoLayout.push(id);
          } else {
            nodesOutsideAutoLayout.push(id);
          }
        }

        if (nodesOutsideAutoLayout.length > 0) {
          e.preventDefault();

          const step = e.shiftKey ? 10 : 1;
          let dx = 0;
          let dy = 0;

          if (e.code === "ArrowLeft") dx = -step;
          else if (e.code === "ArrowRight") dx = step;
          else if (e.code === "ArrowUp") dy = -step;
          else if (e.code === "ArrowDown") dy = step;

          saveHistory(createSnapshot(useSceneStore.getState()));

          for (const id of nodesOutsideAutoLayout) {
            const node = findNodeById(currentNodes, id);
            if (node) {
              updateNode(id, { x: node.x + dx, y: node.y + dy });
            }
          }
          return;
        }

        if (nodesInsideAutoLayout.length === 1) {
          const nodeId = nodesInsideAutoLayout[0];

          const parentContext = findParentFrame(currentNodes, nodeId);
          if (!parentContext.parent || parentContext.parent.type !== "frame")
            return;

          const parentFrame = parentContext.parent;
          const layout = parentFrame.layout;
          const isHorizontal =
            layout?.flexDirection === "row" ||
            layout?.flexDirection === undefined;

          let direction: "prev" | "next" | null = null;

          if (isHorizontal) {
            if (e.code === "ArrowLeft") direction = "prev";
            else if (e.code === "ArrowRight") direction = "next";
          } else {
            if (e.code === "ArrowUp") direction = "prev";
            else if (e.code === "ArrowDown") direction = "next";
          }

          if (!direction) return;

          e.preventDefault();

          const currentIndex = parentFrame.children.findIndex(
            (c) => c.id === nodeId,
          );
          if (currentIndex === -1) return;

          const newIndex =
            direction === "prev"
              ? Math.max(0, currentIndex - 1)
              : Math.min(parentFrame.children.length - 1, currentIndex + 1);

          if (newIndex === currentIndex) return;

          saveHistory(createSnapshot(useSceneStore.getState()));
          moveNode(nodeId, parentFrame.id, newIndex);
          return;
        }
      }

      if (e.code === "Escape") {
        const drawState = useDrawModeStore.getState();
        if (drawState.activeTool || drawState.isDrawing) {
          cancelDrawing();
          return;
        }
        if (useSelectionStore.getState().exitContainer()) return;
        clearSelection();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
        if (!isMiddleMouseDown) {
          setIsPanning(false);
        }
      }
    };

    const handlePaste = async (e: ClipboardEvent) => {
      const isTyping = isTypingTarget(e);
      if (isTyping) return;

      const clipboardState = useClipboardStore.getState();
      const syncText = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      const imageItems =
        e.clipboardData?.items == null
          ? []
          : Array.from(e.clipboardData.items).filter((item) =>
              item.type.startsWith("image/"),
            );
      const shouldPreferInternalClipboard =
        clipboardState.copiedNodes.length > 0 &&
        Date.now() - clipboardState.lastCopiedAt <= INTERNAL_CLIPBOARD_PRIORITY_MS;

      if (shouldPreferInternalClipboard) {
        e.preventDefault();
        pasteInternalNodes(clipboardState.copiedNodes);
        return;
      }

      if (imageItems.length > 0) {
        e.preventDefault();
        const viewportCenter = getViewportCenter(dimensions);
        const selectionState = useSelectionStore.getState();
        const currentNodes = useSceneStore.getState().getNodes();
        const imagePlans: ImageImportPlan[] = [];

        for (let i = 0; i < imageItems.length; i++) {
          const file = imageItems[i]?.getAsFile();
          if (!file) continue;
          try {
            const plan = await createImageImportPlan({
              blob: file,
              name: file.name,
              anchorWorld: {
                x: viewportCenter.x + i * 20,
                y: viewportCenter.y + i * 20,
              },
              canvasSize: {
                width: dimensions.width,
                height: dimensions.height,
              },
              nodes: currentNodes,
              selectedIds: selectionState.selectedIds,
              enteredContainerId: selectionState.enteredContainerId,
              fallbackName: imageItems.length > 1 ? `Pasted Image ${i + 1}` : "Pasted Image",
            });
            imagePlans.push(plan);
          } catch {
            // skip failed clipboard image
          }
        }

        applyImageImportPlans({
          plans: imagePlans,
          addNode,
          addChildToFrame,
          saveHistory,
          startBatch,
          endBatch,
        });
        return;
      }

      // 1. Try SVG from text/plain
      if (syncText && syncText.includes("<svg") && syncText.includes("</svg>")) {
        e.preventDefault();
        const result = parseSvgToNodes(syncText);
        if (result) {
          const viewportCenter = getViewportCenter(dimensions);
          result.node.x = viewportCenter.x - result.node.width / 2;
          result.node.y = viewportCenter.y - result.node.height / 2;

          addNode(result.node);
          useSelectionStore.getState().select(result.node.id);
          return;
        }
      }

      // 2. Internal clipboard (copiedNodes) — fallback when no external data matched
      if (clipboardState.copiedNodes.length > 0) {
        e.preventDefault();
        pasteInternalNodes(clipboardState.copiedNodes);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("paste", handlePaste);
    };
  }, [
    addChildToFrame,
    addNode,
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
    nodes,
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
