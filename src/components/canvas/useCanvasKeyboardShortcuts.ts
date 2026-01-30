import { useEffect } from "react";
import type { FrameNode, SceneNode } from "@/types/scene";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { cloneNodeWithNewId } from "@/utils/cloneNode";
import {
  findComponentById,
  findNodeById,
  findParentFrame,
  findParentFrameInComponent,
} from "@/utils/nodeUtils";

interface CanvasKeyboardShortcutsParams {
  nodes: SceneNode[];
  copiedNode: SceneNode | null;
  dimensions: { width: number; height: number };
  isMiddleMouseDown: boolean;
  setIsSpacePressed: (value: boolean) => void;
  setIsPanning: (value: boolean) => void;
  addNode: (node: SceneNode) => void;
  deleteNode: (id: string) => void;
  updateNode: (id: string, updates: Partial<SceneNode>) => void;
  moveNode: (nodeId: string, targetParentId: string, index: number) => void;
  groupNodes: (ids: string[]) => string | null;
  ungroupNodes: (ids: string[]) => string[];
  setNodesWithoutHistory: (nodes: SceneNode[]) => void;
  saveHistory: (nodes: SceneNode[]) => void;
  startBatch: () => void;
  endBatch: () => void;
  undo: (nodes: SceneNode[]) => SceneNode[] | null;
  redo: (nodes: SceneNode[]) => SceneNode[] | null;
  fitToContent: (nodes: SceneNode[], width: number, height: number) => void;
  toggleTool: (tool: "frame" | "rect" | "ellipse" | "text") => void;
  cancelDrawing: () => void;
  clearSelection: () => void;
  exitInstanceEditMode: () => void;
  copyNode: (node: SceneNode) => void;
}

export function useCanvasKeyboardShortcuts({
  nodes,
  copiedNode,
  dimensions,
  isMiddleMouseDown,
  setIsSpacePressed,
  setIsPanning,
  addNode,
  deleteNode,
  updateNode,
  moveNode,
  groupNodes,
  ungroupNodes,
  setNodesWithoutHistory,
  saveHistory,
  startBatch,
  endBatch,
  undo,
  redo,
  fitToContent,
  toggleTool,
  cancelDrawing,
  clearSelection,
  exitInstanceEditMode,
  copyNode,
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
        const { selectedIds, editingNodeId, editingMode } =
          useSelectionStore.getState();
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
                    .selectDescendant(instanceContext.instanceId, parentFrame.id);
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
        e.preventDefault();
        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length === 1) {
          const nodeToCopy = findNodeById(nodes, ids[0]);
          if (nodeToCopy) {
            copyNode(nodeToCopy);
          }
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.code === "KeyX") {
        e.preventDefault();
        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length === 1) {
          const nodeToCut = findNodeById(nodes, ids[0]);
          if (nodeToCut) {
            copyNode(nodeToCut);
            const currentNodes = useSceneStore.getState().nodes;
            saveHistory(currentNodes);
            deleteNode(ids[0]);
            clearSelection();
          }
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.code === "KeyV") {
        e.preventDefault();
        if (copiedNode) {
          const clonedNode = cloneNodeWithNewId(copiedNode);
          addNode(clonedNode);
          useSelectionStore.getState().select(clonedNode.id);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && !e.shiftKey) {
        e.preventDefault();
        const currentNodes = useSceneStore.getState().nodes;
        const prevState = undo(currentNodes);
        if (prevState) {
          setNodesWithoutHistory(prevState);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && e.shiftKey) {
        e.preventDefault();
        const currentNodes = useSceneStore.getState().nodes;
        const nextState = redo(currentNodes);
        if (nextState) {
          setNodesWithoutHistory(nextState);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.code === "Digit0") {
        e.preventDefault();
        const currentNodes = useSceneStore.getState().nodes;
        fitToContent(currentNodes, dimensions.width, dimensions.height);
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

      if (e.altKey && (e.metaKey || e.ctrlKey) && e.code === "KeyK") {
        e.preventDefault();
        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length === 1) {
          const selectedNode = findNodeById(nodes, ids[0]);
          if (selectedNode && selectedNode.type === "frame") {
            const frameNode = selectedNode as FrameNode;
            if (!frameNode.reusable) {
              updateNode(selectedNode.id, { reusable: true });
            }
          }
        }
        return;
      }

      if (!isTyping && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
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
          const currentNodes = useSceneStore.getState().nodes;
          saveHistory(currentNodes);
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

        const currentNodes = useSceneStore.getState().nodes;

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

          saveHistory(currentNodes);

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

          saveHistory(currentNodes);
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
        const currentEditingInstanceId =
          useSelectionStore.getState().editingInstanceId;
        if (currentEditingInstanceId) {
          exitInstanceEditMode();
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

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    addNode,
    cancelDrawing,
    clearSelection,
    copiedNode,
    copyNode,
    deleteNode,
    dimensions.height,
    dimensions.width,
    endBatch,
    exitInstanceEditMode,
    fitToContent,
    groupNodes,
    isMiddleMouseDown,
    moveNode,
    nodes,
    redo,
    saveHistory,
    setIsPanning,
    setIsSpacePressed,
    setNodesWithoutHistory,
    startBatch,
    toggleTool,
    undo,
    ungroupNodes,
    updateNode,
  ]);
}
