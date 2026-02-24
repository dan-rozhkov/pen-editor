import { useEffect } from "react";
import { isContainerNode, type FrameNode, type RefNode, type SceneNode, type HistorySnapshot } from "@/types/scene";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { cloneNodeWithNewId } from "@/utils/cloneNode";
import {
  findComponentById,
  findNodeById,
  findParentFrame,
  findParentFrameInComponent,
} from "@/utils/nodeUtils";
import { parseSvgToNodes } from "@/utils/svgUtils";

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
  toggleTool: (tool: "frame" | "rect" | "ellipse" | "text" | "line" | "polygon") => void;
  cancelDrawing: () => void;
  clearSelection: () => void;
  clearInstanceContext: () => void;
  copyNodes: (nodes: SceneNode[]) => void;
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
  clearInstanceContext,
  copyNodes,
}: CanvasKeyboardShortcutsParams) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === "Enter" && !e.shiftKey) {
        if (isTyping) return;
        const { selectedIds, editingNodeId, editingMode, instanceContext } =
          useSelectionStore.getState();

        // Descendant text editing: Enter on a text descendant in instance edit mode
        if (!editingMode && instanceContext) {
          const instance = findNodeById(nodes, instanceContext.instanceId);
          if (instance && instance.type === "ref") {
            const component = findComponentById(nodes, (instance as RefNode).componentId);
            if (component) {
              const descendant = findNodeById(component.children, instanceContext.descendantId);
              if (descendant?.type === "text") {
                e.preventDefault();
                useSelectionStore.getState().startDescendantEditing();
                return;
              }
            }
          }
        }

        if (!editingNodeId && !editingMode && selectedIds.length === 1) {
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

        const { selectedIds, instanceContext } = useSelectionStore.getState();
        if (instanceContext) {
          const instance = findNodeById(nodes, instanceContext.instanceId);
          if (instance && instance.type === "ref") {
            const component = findComponentById(nodes, instance.componentId);
            if (component) {
              const parentFrame = findParentFrameInComponent(
                component.children,
                instanceContext.descendantId,
                component,
              );
              if (parentFrame) {
                if (parentFrame.id === component.id) {
                  useSelectionStore.getState().clearDescendantSelection();
                } else {
                  useSelectionStore
                    .getState()
                    .selectDescendant(
                      instanceContext.instanceId,
                      parentFrame.id,
                    );
                }
              }
            }
          }
        } else if (selectedIds.length === 1) {
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

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "KeyK") {
        e.preventDefault();
        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length === 1) {
          const selectedNode = findNodeById(nodes, ids[0]);
          if (selectedNode?.type === "frame") {
            const frameNode = selectedNode as FrameNode;
            if (!frameNode.reusable) updateNode(selectedNode.id, { reusable: true });
          } else if (selectedNode?.type === "group") {
            const converted = useSceneStore.getState().convertNodeType(selectedNode.id);
            if (converted) {
              updateNode(selectedNode.id, { reusable: true });
            }
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
        const selectionState = useSelectionStore.getState();
        const { selectedIds: ids, instanceContext, selectedDescendantIds } =
          selectionState;

        if (instanceContext) {
          const descendantIds =
            selectedDescendantIds.length > 0
              ? selectedDescendantIds
              : [instanceContext.descendantId];
          if (descendantIds.length > 0) {
            saveHistory(createSnapshot(useSceneStore.getState()));
            startBatch();
            const updateDescendantOverride =
              useSceneStore.getState().updateDescendantOverride;
            descendantIds.forEach((descendantId) => {
              updateDescendantOverride(instanceContext.instanceId, descendantId, {
                enabled: false,
              });
            });
            endBatch();
            clearSelection();
          }
          return;
        }

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
        const currentInstanceContext =
          useSelectionStore.getState().instanceContext;
        if (currentInstanceContext) {
          clearInstanceContext();
        } else {
          clearSelection();
        }
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

    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (isTyping) return;

      const syncText = e.clipboardData?.getData("text/plain")?.trim() ?? "";

      // 1. Try SVG from text/plain
      if (syncText && syncText.includes("<svg") && syncText.includes("</svg>")) {
        e.preventDefault();
        const result = parseSvgToNodes(syncText);
        if (result) {
          const { x: vpX, y: vpY, scale } = useViewportStore.getState();
          const viewportCenterX = (-vpX + window.innerWidth / 2) / scale;
          const viewportCenterY = (-vpY + window.innerHeight / 2) / scale;
          result.node.x = viewportCenterX - result.node.width / 2;
          result.node.y = viewportCenterY - result.node.height / 2;

          addNode(result.node);
          useSelectionStore.getState().select(result.node.id);
          return;
        }
      }

      // 2. Internal clipboard (copiedNodes) — fallback when no external data matched
      if (copiedNodes.length > 0) {
        e.preventDefault();
        const clonedNodes = copiedNodes.map((n) => cloneNodeWithNewId(n));
        const selectedIds = useSelectionStore.getState().selectedIds;
        let targetContainerId: string | null = null;

        if (selectedIds.length === 1) {
          const selectedNode = findNodeById(nodes, selectedIds[0]);
          if (selectedNode && isContainerNode(selectedNode)) {
            targetContainerId = selectedNode.id;
          }
        }

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

        useSelectionStore.getState().setSelectedIds(clonedNodes.map((n) => n.id));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
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
    dimensions.height,
    dimensions.width,
    endBatch,
    clearInstanceContext,
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
