import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { Stage, Layer, Rect, Transformer } from "react-konva";
import Konva from "konva";
import { useViewportStore } from "../store/viewportStore";
import { useSceneStore } from "../store/sceneStore";
import { useCanvasRefStore } from "../store/canvasRefStore";
import { useSelectionStore } from "../store/selectionStore";
import { useHistoryStore } from "../store/historyStore";
import { useDragStore } from "../store/dragStore";
import { useClipboardStore } from "../store/clipboardStore";
import { RenderNode } from "./nodes/RenderNode";
import { DropIndicator } from "./DropIndicator";
import { InlineTextEditor } from "./InlineTextEditor";
import { InlineNameEditor } from "./InlineNameEditor";
import { FrameNameLabel } from "./nodes/FrameNameLabel";
import { NodeSizeLabel } from "./nodes/NodeSizeLabel";
import type { TextNode, FrameNode, GroupNode, SceneNode } from "../types/scene";
import { rectsIntersect } from "../utils/dragUtils";
import { getViewportBounds, isNodeVisible } from "../utils/viewportUtils";
import {
  getNodeAbsolutePosition,
  getNodeAbsolutePositionWithLayout,
  findParentFrame,
  findComponentById,
  findNodeById,
} from "../utils/nodeUtils";
import { useLayoutStore } from "../store/layoutStore";
import { useDrawModeStore } from "../store/drawModeStore";
import { calculateFrameIntrinsicSize } from "../utils/yogaLayout";
import { generateId } from "../types/scene";
import type { DrawToolType } from "../store/drawModeStore";

export function Canvas() {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isMiddleMouseDown, setIsMiddleMouseDown] = useState(false);
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null);

  // Marquee selection state
  const isMarqueeActive = useRef(false);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const marqueeShiftHeld = useRef(false);
  const marqueePreShiftIds = useRef<string[]>([]);
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const {
    scale,
    x,
    y,
    isPanning,
    setPosition,
    setIsPanning,
    startSmoothZoom,
    fitToContent,
  } = useViewportStore();
  const nodes = useSceneStore((state) => state.nodes);
  const pageBackground = useSceneStore((state) => state.pageBackground);
  const addNode = useSceneStore((state) => state.addNode);
  const { copiedNode, copyNode } = useClipboardStore();
  const setStageRef = useCanvasRefStore((s) => s.setStageRef);
  const calculateLayoutForFrame = useLayoutStore(
    (state) => state.calculateLayoutForFrame,
  );

  // Calculate viewport bounds and filter visible nodes
  const viewportBounds = useMemo(
    () => getViewportBounds(scale, x, y, dimensions.width, dimensions.height),
    [scale, x, y, dimensions.width, dimensions.height],
  );

  const visibleNodes = useMemo(
    () => nodes.filter((node) => isNodeVisible(node, viewportBounds)),
    [nodes, viewportBounds],
  );
  const deleteNode = useSceneStore((state) => state.deleteNode);
  const updateNode = useSceneStore((state) => state.updateNode);
  const moveNode = useSceneStore((state) => state.moveNode);
  const groupNodes = useSceneStore((state) => state.groupNodes);
  const ungroupNodes = useSceneStore((state) => state.ungroupNodes);
  const setNodesWithoutHistory = useSceneStore(
    (state) => state.setNodesWithoutHistory,
  );
  const {
    selectedIds,
    clearSelection,
    setSelectedIds,
    editingNodeId,
    editingMode,
    isSelected,
    exitInstanceEditMode,
    resetContainerContext,
  } = useSelectionStore();
  const { undo, redo, saveHistory, startBatch, endBatch } = useHistoryStore();
  const dropIndicator = useDragStore((state) => state.dropIndicator);
  const {
    activeTool,
    isDrawing,
    drawStart,
    drawCurrent,
    startDrawing,
    updateDrawing,
    endDrawing,
    cancelDrawing,
    toggleTool,
  } = useDrawModeStore();

  // Helper: create a node from draw tool type and bounding rect
  const createNodeFromDraw = useCallback(
    (tool: DrawToolType, rx: number, ry: number, rw: number, rh: number) => {
      const id = generateId();
      let node: SceneNode;
      switch (tool) {
        case "frame":
          node = {
            id,
            type: "frame",
            x: rx,
            y: ry,
            width: rw,
            height: rh,
            fill: "#ffffff",
            stroke: "#cccccc",
            strokeWidth: 1,
            children: [],
          };
          break;
        case "rect":
          node = {
            id,
            type: "rect",
            x: rx,
            y: ry,
            width: rw,
            height: rh,
            fill: "#4a90d9",
            cornerRadius: 4,
          };
          break;
        case "ellipse":
          node = {
            id,
            type: "ellipse",
            x: rx,
            y: ry,
            width: rw,
            height: rh,
            fill: "#d94a4a",
          };
          break;
        case "text":
          node = {
            id,
            type: "text",
            x: rx,
            y: ry,
            width: rw,
            height: rh,
            text: "Text",
            fontSize: 18,
            fontFamily: "Arial",
            fontWeight: "normal",
            fill: "#333333",
            textWidthMode: "auto",
          };
          break;
      }
      addNode(node);
      useSelectionStore.getState().select(id);
    },
    [addNode],
  );

  // Compute draw preview rect from drawStart/drawCurrent
  const drawPreviewRect = useMemo(() => {
    if (!isDrawing || !drawStart || !drawCurrent) return null;
    return {
      x: Math.min(drawStart.x, drawCurrent.x),
      y: Math.min(drawStart.y, drawCurrent.y),
      width: Math.abs(drawCurrent.x - drawStart.x),
      height: Math.abs(drawCurrent.y - drawStart.y),
    };
  }, [isDrawing, drawStart, drawCurrent]);

  // Clone a node with new IDs (including nested children)
  // If node is a reusable component, create an instance (RefNode) instead of copying the component
  const cloneNodeWithNewId = (node: SceneNode): SceneNode => {
    const newId = generateId();

    if (node.type === "frame") {
      // If it's a reusable component, create an instance instead
      if ((node as FrameNode).reusable) {
        return {
          id: newId,
          type: "ref",
          componentId: node.id,
          x: node.x + 20, // Offset pasted node
          y: node.y + 20,
          width: node.width,
          height: node.height,
          fill: node.fill,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth,
          visible: node.visible,
          enabled: node.enabled,
        };
      }

      // Otherwise, clone the frame with all children
      return {
        ...node,
        id: newId,
        x: node.x + 20, // Offset pasted node
        y: node.y + 20,
        children: node.children.map((child) => cloneNodeWithNewId(child)),
      } as FrameNode;
    }

    // Clone group with all children
    if (node.type === "group") {
      return {
        ...node,
        id: newId,
        x: node.x + 20,
        y: node.y + 20,
        children: (node as import("../types/scene").GroupNode).children.map((child) => cloneNodeWithNewId(child)),
      } as import("../types/scene").GroupNode;
    }

    // For ref nodes, create a new instance of the same component
    if (node.type === "ref") {
      return {
        ...node,
        id: newId,
        x: node.x + 20, // Offset pasted node
        y: node.y + 20,
        // Keep the same componentId and descendants overrides
      };
    }

    return {
      ...node,
      id: newId,
      x: node.x + 20, // Offset pasted node
      y: node.y + 20,
    } as SceneNode;
  };

  // Find a node by ID (including nested nodes)
  const findNodeByIdGeneric = (
    searchNodes: SceneNode[],
    id: string,
  ): SceneNode | null => {
    for (const node of searchNodes) {
      if (node.id === id) return node;
      if ((node.type === "frame" || node.type === "group") && (node as any).children) {
        const found = findNodeByIdGeneric((node as any).children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const findParentFrameInComponent = (
    children: SceneNode[],
    targetId: string,
    parent: FrameNode,
  ): FrameNode | null => {
    for (const child of children) {
      if (child.id === targetId) return parent;
      if (child.type === "frame") {
        const found = findParentFrameInComponent(
          child.children,
          targetId,
          child,
        );
        if (found) return found;
      } else if (child.type === "group") {
        const found = findParentFrameInComponent(
          (child as import("../types/scene").GroupNode).children,
          targetId,
          parent,
        );
        if (found) return found;
      }
    }
    return null;
  };

  // Find the text node being edited
  const editingTextNode =
    editingNodeId && editingMode === "text"
      ? (findNodeByIdGeneric(nodes, editingNodeId) as TextNode | null)
      : null;

  // Find the frame node whose name is being edited
  const editingNameNode =
    editingNodeId && editingMode === "name"
      ? (findNodeByIdGeneric(nodes, editingNodeId) as FrameNode | null)
      : null;

  // Determine transformer color based on whether a component or instance is selected
  const transformerColor = useMemo(() => {
    const defaultColor = "#0d99ff"; // Blue
    const componentColor = "#9747ff"; // Purple (Figma component color)

    // Check if any selected node is a reusable component or an instance
    for (const id of selectedIds) {
      const node = findNodeByIdGeneric(nodes, id);
      if (
        node &&
        ((node.type === "frame" && (node as FrameNode).reusable) ||
          node.type === "ref")
      ) {
        return componentColor;
      }
    }
    return defaultColor;
  }, [selectedIds, nodes]);

  // Get absolute position for name editor
  const editingNamePosition = editingNameNode
    ? getNodeAbsolutePosition(nodes, editingNameNode.id)
    : null;

  // Get absolute position for text editor (with layout calculation for auto-layout)
  const editingTextPosition = editingTextNode
    ? getNodeAbsolutePositionWithLayout(
        nodes,
        editingTextNode.id,
        calculateLayoutForFrame,
      )
    : null;

  // Collect all frame nodes with their absolute positions for rendering labels
  const collectFrameNodes = useMemo(() => {
    const frames: Array<{
      node: FrameNode | GroupNode;
      absX: number;
      absY: number;
      isNested: boolean;
    }> = [];

    const traverse = (
      searchNodes: SceneNode[],
      accX: number,
      accY: number,
      isNested: boolean,
    ) => {
      for (const node of searchNodes) {
        if (node.type === "frame" || node.type === "group") {
          frames.push({
            node: node as FrameNode | GroupNode,
            absX: accX + node.x,
            absY: accY + node.y,
            isNested,
          });
          // Recursively collect nested containers (mark them as nested)
          traverse((node as FrameNode | GroupNode).children, accX + node.x, accY + node.y, true);
        }
      }
    };

    traverse(visibleNodes, 0, 0, false);
    return frames;
  }, [visibleNodes]);

  // Collect selected nodes with their absolute positions and effective sizes
  const collectSelectedNodes = useMemo(() => {
    const result: Array<{
      node: SceneNode;
      absX: number;
      absY: number;
      effectiveWidth: number;
      effectiveHeight: number;
    }> = [];

    const traverse = (searchNodes: SceneNode[]) => {
      for (const node of searchNodes) {
        if (selectedIds.includes(node.id)) {
          // Get absolute position with layout calculation for auto-layout
          const absPos = getNodeAbsolutePositionWithLayout(
            nodes,
            node.id,
            calculateLayoutForFrame,
          );
          if (!absPos) continue;

          // Calculate effective size for auto-layout frames with fit_content
          let effectiveWidth = node.width;
          let effectiveHeight = node.height;

          if (node.type === "frame" && node.layout?.autoLayout) {
            const fitWidth = node.sizing?.widthMode === "fit_content";
            const fitHeight = node.sizing?.heightMode === "fit_content";
            if (fitWidth || fitHeight) {
              const intrinsicSize = calculateFrameIntrinsicSize(node, {
                fitWidth,
                fitHeight,
              });
              if (fitWidth) effectiveWidth = intrinsicSize.width;
              if (fitHeight) effectiveHeight = intrinsicSize.height;
            }
          }

          // Handle nodes with fill_container inside auto-layout
          const parentContext = findParentFrame(nodes, node.id);
          if (parentContext.isInsideAutoLayout && parentContext.parent) {
            const widthMode = node.sizing?.widthMode ?? "fixed";
            const heightMode = node.sizing?.heightMode ?? "fixed";

            // If sizing mode is not fixed, get sizes from Yoga layout
            if (widthMode !== "fixed" || heightMode !== "fixed") {
              const layoutChildren = calculateLayoutForFrame(
                parentContext.parent,
              );
              const layoutNode = layoutChildren.find((n) => n.id === node.id);
              if (layoutNode) {
                if (widthMode !== "fixed") effectiveWidth = layoutNode.width;
                if (heightMode !== "fixed") effectiveHeight = layoutNode.height;
              }
            }
          }

          result.push({
            node,
            absX: absPos.x,
            absY: absPos.y,
            effectiveWidth,
            effectiveHeight,
          });
        }

        // Recurse into containers (frames and groups)
        if (node.type === "frame" || node.type === "group") {
          traverse((node as FrameNode).children);
        }
      }
    };

    traverse(visibleNodes);
    return result;
  }, [visibleNodes, selectedIds, nodes, calculateLayoutForFrame]);

  // Compute selection bounding box for multi-selection group label
  const selectionBoundingBox = useMemo(() => {
    if (collectSelectedNodes.length <= 1) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const {
      absX,
      absY,
      effectiveWidth,
      effectiveHeight,
    } of collectSelectedNodes) {
      minX = Math.min(minX, absX);
      minY = Math.min(minY, absY);
      maxX = Math.max(maxX, absX + effectiveWidth);
      maxY = Math.max(maxY, absY + effectiveHeight);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [collectSelectedNodes]);

  // Update transformer nodes when selection changes
  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;

    // Find selected nodes on stage, excluding the node being text-edited
    const selectedNodes: Konva.Node[] = [];
    selectedIds.forEach((id) => {
      // Hide transformer for the node being inline-edited
      if (editingNodeId === id && editingMode === "text") return;
      const node = stage.findOne(`#${id}`);
      if (node) {
        selectedNodes.push(node);
      }
    });

    transformer.nodes(selectedNodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedIds, editingNodeId, editingMode]);

  // Resize handler
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // Register stage ref for export functionality
  useEffect(() => {
    setStageRef(stageRef.current);
    return () => setStageRef(null);
  }, [setStageRef]);

  // Keyboard event handlers for spacebar panning, deletion, undo/redo, and escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input field
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Enter - edit selected text node
      if (e.key === "Enter" && !e.shiftKey) {
        if (isTyping) return;
        const { selectedIds, editingNodeId, editingMode } =
          useSelectionStore.getState();
        if (!editingNodeId && !editingMode && selectedIds.length === 1) {
          const selectedNode = findNodeByIdGeneric(nodes, selectedIds[0]);
          if (selectedNode?.type === "text") {
            e.preventDefault();
            useSelectionStore.getState().startEditing(selectedNode.id);
            return;
          }
        }
      }

      // Shift+Enter - select nearest parent
      if (e.key === "Enter" && e.shiftKey) {
        if (isTyping) return;
        e.preventDefault();

        const { selectedIds, instanceContext } = useSelectionStore.getState();
        if (instanceContext) {
          const instance = findNodeByIdGeneric(
            nodes,
            instanceContext.instanceId,
          );
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

      // Copy: Cmd+C (Mac) or Ctrl+C (Win/Linux)
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyC") {
        e.preventDefault();
        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length === 1) {
          const nodeToCopy = findNodeByIdGeneric(nodes, ids[0]);
          if (nodeToCopy) {
            copyNode(nodeToCopy);
          }
        }
        return;
      }

      // Cut: Cmd+X (Mac) or Ctrl+X (Win/Linux)
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyX") {
        e.preventDefault();
        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length === 1) {
          const nodeToCut = findNodeByIdGeneric(nodes, ids[0]);
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

      // Paste: Cmd+V (Mac) or Ctrl+V (Win/Linux)
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyV") {
        e.preventDefault();
        if (copiedNode) {
          const clonedNode = cloneNodeWithNewId(copiedNode);
          addNode(clonedNode);
          // Select the newly pasted node
          useSelectionStore.getState().select(clonedNode.id);
        }
        return;
      }

      // Undo: Cmd+Z (Mac) or Ctrl+Z (Win/Linux)
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && !e.shiftKey) {
        e.preventDefault();
        const currentNodes = useSceneStore.getState().nodes;
        const prevState = undo(currentNodes);
        if (prevState) {
          setNodesWithoutHistory(prevState);
        }
        return;
      }

      // Redo: Cmd+Shift+Z (Mac) or Ctrl+Shift+Z (Win/Linux)
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && e.shiftKey) {
        e.preventDefault();
        const currentNodes = useSceneStore.getState().nodes;
        const nextState = redo(currentNodes);
        if (nextState) {
          setNodesWithoutHistory(nextState);
        }
        return;
      }

      // Zoom to fit: Cmd+0 (Mac) or Ctrl+0 (Win/Linux)
      if ((e.metaKey || e.ctrlKey) && e.code === "Digit0") {
        e.preventDefault();
        const currentNodes = useSceneStore.getState().nodes;
        fitToContent(currentNodes, dimensions.width, dimensions.height);
        return;
      }

      // Group: Cmd+G (Mac) or Ctrl+G (Win)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyG") {
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

      // Ungroup: Cmd+Shift+G (Mac) or Ctrl+Shift+G (Win)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "KeyG") {
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

      // Create Component: Opt+Cmd+K (Mac) or Alt+Ctrl+K (Windows)
      if (e.altKey && (e.metaKey || e.ctrlKey) && e.code === "KeyK") {
        e.preventDefault();
        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length === 1) {
          const selectedNode = findNodeByIdGeneric(nodes, ids[0]);
          if (selectedNode && selectedNode.type === "frame") {
            const frameNode = selectedNode as FrameNode;
            // Don't apply to already existing components
            if (!frameNode.reusable) {
              updateNode(selectedNode.id, { reusable: true });
            }
          }
        }
        return;
      }

      // Tool shortcuts: F, R, O, T activate draw mode
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

      // Spacebar panning (skip if typing)
      if (e.code === "Space" && !e.repeat) {
        if (isTyping) return;
        e.preventDefault();
        setIsSpacePressed(true);
        setIsPanning(true);
      }

      // Delete/Backspace - delete selected elements
      if (e.code === "Delete" || e.code === "Backspace") {
        if (isTyping) return;
        e.preventDefault();
        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length > 0) {
          // Save history once before batch delete
          const currentNodes = useSceneStore.getState().nodes;
          saveHistory(currentNodes);
          startBatch();
          ids.forEach((id) => deleteNode(id));
          endBatch();
          clearSelection();
        }
      }

      // Arrow keys for moving nodes on canvas or reordering inside auto-layout
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)
      ) {
        if (isTyping) return;

        const ids = useSelectionStore.getState().selectedIds;
        if (ids.length === 0) return;

        const currentNodes = useSceneStore.getState().nodes;

        // Categorize selected nodes
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

        // Case 1: Move nodes on canvas (outside auto-layout)
        if (nodesOutsideAutoLayout.length > 0) {
          e.preventDefault();

          const step = e.shiftKey ? 10 : 1;
          let dx = 0,
            dy = 0;

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

        // Case 2: Reorder inside auto-layout (single selection only)
        if (nodesInsideAutoLayout.length === 1) {
          const nodeId = nodesInsideAutoLayout[0];

          const parentContext = findParentFrame(currentNodes, nodeId);
          if (!parentContext.parent) return;

          const parentFrame = parentContext.parent;
          const layout = parentFrame.layout;
          const isHorizontal =
            layout?.flexDirection === "row" ||
            layout?.flexDirection === undefined;

          // Determine movement direction
          let direction: "prev" | "next" | null = null;

          if (isHorizontal) {
            // Horizontal layout: only ←→
            if (e.code === "ArrowLeft") direction = "prev";
            else if (e.code === "ArrowRight") direction = "next";
          } else {
            // Vertical layout: only ↑↓
            if (e.code === "ArrowUp") direction = "prev";
            else if (e.code === "ArrowDown") direction = "next";
          }

          if (!direction) return; // Irrelevant arrow key for this layout direction

          e.preventDefault();

          // Find current index and calculate new index
          const currentIndex = parentFrame.children.findIndex(
            (c) => c.id === nodeId,
          );
          if (currentIndex === -1) return;

          const newIndex =
            direction === "prev"
              ? Math.max(0, currentIndex - 1)
              : Math.min(parentFrame.children.length - 1, currentIndex + 1);

          if (newIndex === currentIndex) return; // Already at the edge

          // Move the element
          saveHistory(currentNodes);
          moveNode(nodeId, parentFrame.id, newIndex);
          return;
        }
      }

      // Escape - cancel draw mode, exit instance edit mode, or clear selection
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
    isMiddleMouseDown,
    setIsPanning,
    deleteNode,
    updateNode,
    clearSelection,
    undo,
    redo,
    setNodesWithoutHistory,
    saveHistory,
    startBatch,
    endBatch,
    fitToContent,
    dimensions.width,
    dimensions.height,
    exitInstanceEditMode,
    nodes,
    copyNode,
    copiedNode,
    addNode,
    moveNode,
    toggleTool,
    cancelDrawing,
  ]);

  // Mouse wheel handler (Figma-style)
  // - Scroll = pan vertically
  // - Shift + scroll = pan horizontally
  // - Cmd/Ctrl + scroll = smooth zoom with animation
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();

      const stage = stageRef.current;
      if (!stage) return;

      // Cmd/Ctrl + scroll = smooth zoom
      if (e.evt.metaKey || e.evt.ctrlKey) {
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;

        // Pass raw deltaY to startSmoothZoom for smooth accumulation
        startSmoothZoom(e.evt.deltaY, pointerPos.x, pointerPos.y);
      } else {
        // Normal scroll = pan
        // Shift + scroll = horizontal pan
        const dx = e.evt.shiftKey ? -e.evt.deltaY : -e.evt.deltaX;
        const dy = e.evt.shiftKey ? 0 : -e.evt.deltaY;

        setPosition(x + dx, y + dy);
      }
    },
    [x, y, startSmoothZoom, setPosition],
  );

  // Pan handlers
  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Middle mouse button (button 1)
      if (e.evt.button === 1) {
        e.evt.preventDefault();
        setIsMiddleMouseDown(true);
        setIsPanning(true);
        const stage = stageRef.current;
        if (stage) {
          lastPointerPosition.current = stage.getPointerPosition();
        }
      } else if (isSpacePressed && e.evt.button === 0) {
        // Left click while space is pressed
        const stage = stageRef.current;
        if (stage) {
          lastPointerPosition.current = stage.getPointerPosition();
        }
      } else if (e.evt.button === 0) {
        // If draw mode is active, start drawing
        const currentActiveTool = useDrawModeStore.getState().activeTool;
        if (currentActiveTool) {
          const stage = stageRef.current;
          if (stage) {
            const pos = stage.getRelativePointerPosition();
            if (pos) {
              startDrawing(pos);
            }
          }
          return;
        }

        // Left click on empty space - start marquee selection and reset container context
        const clickedOnEmpty =
          e.target === e.target.getStage() || e.target.name() === "background";
        if (clickedOnEmpty) {
          // Reset nested selection context when clicking empty space
          resetContainerContext();
          const stage = stageRef.current;
          if (stage) {
            const pos = stage.getRelativePointerPosition();
            if (pos) {
              isMarqueeActive.current = true;
              marqueeStart.current = pos;
              marqueeShiftHeld.current = e.evt.shiftKey;
              marqueePreShiftIds.current = e.evt.shiftKey
                ? useSelectionStore.getState().selectedIds.slice()
                : [];
              if (!e.evt.shiftKey) {
                clearSelection();
              }
            }
          }
        }
      }
    },
    [isSpacePressed, setIsPanning, clearSelection, resetContainerContext, startDrawing],
  );

  const handleMouseMove = useCallback(() => {
    // Drawing mode
    if (useDrawModeStore.getState().isDrawing) {
      const stage = stageRef.current;
      if (stage) {
        const pos = stage.getRelativePointerPosition();
        if (pos) {
          updateDrawing(pos);
        }
      }
      return;
    }

    // Marquee selection
    if (isMarqueeActive.current && marqueeStart.current) {
      const stage = stageRef.current;
      if (!stage) return;

      const pos = stage.getRelativePointerPosition();
      if (!pos) return;

      const startPos = marqueeStart.current;
      const rect = {
        x: Math.min(startPos.x, pos.x),
        y: Math.min(startPos.y, pos.y),
        width: Math.abs(pos.x - startPos.x),
        height: Math.abs(pos.y - startPos.y),
      };
      setMarqueeRect(rect);

      // Find intersecting top-level nodes
      const currentNodes = useSceneStore.getState().nodes;
      const intersecting: string[] = [];
      for (const node of currentNodes) {
        if (node.visible === false) continue;
        const nodeRect = {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        };
        if (rectsIntersect(rect, nodeRect)) {
          intersecting.push(node.id);
        }
      }

      // Union with pre-existing selection if Shift held
      if (marqueeShiftHeld.current) {
        const merged = [
          ...new Set([...marqueePreShiftIds.current, ...intersecting]),
        ];
        setSelectedIds(merged);
      } else {
        setSelectedIds(intersecting);
      }
      return;
    }

    // Panning
    if (!isPanning || !lastPointerPosition.current) return;

    const stage = stageRef.current;
    if (!stage) return;

    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    const dx = pointerPos.x - lastPointerPosition.current.x;
    const dy = pointerPos.y - lastPointerPosition.current.y;

    setPosition(x + dx, y + dy);
    lastPointerPosition.current = pointerPos;
  }, [isPanning, x, y, setPosition, setSelectedIds, updateDrawing]);

  const handleMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // End drawing
      const drawState = useDrawModeStore.getState();
      if (
        drawState.isDrawing &&
        drawState.drawStart &&
        drawState.drawCurrent &&
        drawState.activeTool
      ) {
        const tool = drawState.activeTool;
        const s = drawState.drawStart;
        const c = drawState.drawCurrent;
        const dx = Math.abs(c.x - s.x);
        const dy = Math.abs(c.y - s.y);

        // Default sizes for click-without-drag (< 2px movement)
        const defaults: Record<string, { w: number; h: number }> = {
          frame: { w: 200, h: 150 },
          rect: { w: 150, h: 100 },
          ellipse: { w: 120, h: 120 },
          text: { w: 100, h: 24 },
        };

        let rx: number, ry: number, rw: number, rh: number;
        if (dx < 2 && dy < 2) {
          // Click without drag: use defaults centered on click
          const d = defaults[tool];
          rw = d.w;
          rh = d.h;
          rx = s.x - rw / 2;
          ry = s.y - rh / 2;
        } else {
          rx = Math.min(s.x, c.x);
          ry = Math.min(s.y, c.y);
          rw = dx;
          rh = dy;
        }

        createNodeFromDraw(tool, rx, ry, rw, rh);
        endDrawing();
        return;
      }

      // End marquee selection
      if (isMarqueeActive.current) {
        isMarqueeActive.current = false;
        marqueeStart.current = null;
        marqueeShiftHeld.current = false;
        marqueePreShiftIds.current = [];
        setMarqueeRect(null);
      }

      if (e.evt.button === 1) {
        setIsMiddleMouseDown(false);
        if (!isSpacePressed) {
          setIsPanning(false);
        }
      }
      lastPointerPosition.current = null;
    },
    [isSpacePressed, setIsPanning, createNodeFromDraw, endDrawing],
  );

  // Prevent context menu on middle click
  const handleContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        cursor: isPanning ? "grab" : activeTool ? "crosshair" : "default",
        background: pageBackground,
        position: "relative",
      }}
    >
      {/* Zoom indicator - click to fit all */}
      <div
        onClick={() => fitToContent(nodes, dimensions.width, dimensions.height)}
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          background: "rgba(255, 255, 255, 0.9)",
          padding: "4px 8px",
          borderRadius: 4,
          fontSize: 12,
          fontFamily: "system-ui, sans-serif",
          color: "#666",
          zIndex: 10,
          cursor: "pointer",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          userSelect: "none",
        }}
        title="Click to fit all (Cmd/Ctrl+0)"
      >
        {Math.round(scale * 100)}%
      </div>
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        scaleX={scale}
        scaleY={scale}
        x={x}
        y={y}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
      >
        <Layer>
          {/* Background rect for click detection (invisible, covers visible area) */}
          <Rect
            name="background"
            x={viewportBounds.minX}
            y={viewportBounds.minY}
            width={viewportBounds.maxX - viewportBounds.minX}
            height={viewportBounds.maxY - viewportBounds.minY}
            fill="transparent"
          />
          {/* Render visible scene nodes (viewport culling) */}
          {visibleNodes.map((node) => (
            <RenderNode key={node.id} node={node} />
          ))}
          {/* Drop indicator for auto-layout reordering */}
          {dropIndicator && <DropIndicator indicator={dropIndicator} />}
          {/* Transformer for selection */}
          <Transformer
            ref={transformerRef}
            boundBoxFunc={(oldBox, newBox) => {
              // Limit minimum size
              if (newBox.width < 5 || newBox.height < 5) {
                return oldBox;
              }
              return newBox;
            }}
            keepRatio={false}
            anchorSize={8}
            anchorCornerRadius={2}
            anchorStyleFunc={(anchor) => {
              const name = anchor.name();
              // Show only corner anchors
              if (
                !name.includes("top-left") &&
                !name.includes("top-right") &&
                !name.includes("bottom-left") &&
                !name.includes("bottom-right")
              ) {
                // Hide middle anchors visually but make them larger for easier interaction
                anchor.width(20);
                anchor.height(20);
                anchor.strokeWidth(0);
                anchor.fill("");
                anchor.stroke("");
              }
            }}
            borderStroke={transformerColor}
            anchorStroke={transformerColor}
            anchorFill="#ffffff"
            rotateEnabled={false}
            borderStrokeWidth={1}
            anchorStrokeWidth={1}
          />
          {/* Marquee selection rectangle */}
          {marqueeRect && (
            <Rect
              x={marqueeRect.x}
              y={marqueeRect.y}
              width={marqueeRect.width}
              height={marqueeRect.height}
              fill="rgba(13, 153, 255, 0.1)"
              stroke="#0d99ff"
              strokeWidth={1 / scale}
              listening={false}
            />
          )}
          {/* Drawing preview rectangle */}
          {drawPreviewRect && (
            <Rect
              x={drawPreviewRect.x}
              y={drawPreviewRect.y}
              width={drawPreviewRect.width}
              height={drawPreviewRect.height}
              fill="rgba(13, 153, 255, 0.08)"
              stroke="#0d99ff"
              strokeWidth={1 / scale}
              dash={[4 / scale, 4 / scale]}
              listening={false}
            />
          )}
          {/* Frame name labels - rendered after transformer so they're not included in bounding box */}
          {collectFrameNodes
            .filter(({ isNested }) => !isNested)
            .map(({ node, absX, absY }) => (
              <FrameNameLabel
                key={`label-${node.id}`}
                node={node}
                isSelected={isSelected(node.id)}
                absoluteX={absX}
                absoluteY={absY}
              />
            ))}
          {/* Node size labels - displayed below selected nodes (hidden during text editing) */}
          {collectSelectedNodes.length === 1 &&
            editingMode !== "text" &&
            collectSelectedNodes.map(
              ({ node, absX, absY, effectiveWidth, effectiveHeight }) => (
                <NodeSizeLabel
                  key={`size-${node.id}`}
                  node={node}
                  absoluteX={absX}
                  absoluteY={absY}
                  effectiveWidth={effectiveWidth}
                  effectiveHeight={effectiveHeight}
                />
              ),
            )}
          {/* Group size label - displayed below selection bounding box for multi-selection */}
          {selectionBoundingBox && editingMode !== "text" && (
            <NodeSizeLabel
              key="size-group"
              nodeIds={collectSelectedNodes.map(({ node }) => node.id)}
              absoluteX={selectionBoundingBox.x}
              absoluteY={selectionBoundingBox.y}
              effectiveWidth={selectionBoundingBox.width}
              effectiveHeight={selectionBoundingBox.height}
            />
          )}
        </Layer>
      </Stage>
      {/* Inline text editor overlay */}
      {editingTextNode && editingTextPosition && editingMode === "text" && (
        <InlineTextEditor
          node={editingTextNode}
          absoluteX={editingTextPosition.x}
          absoluteY={editingTextPosition.y}
        />
      )}
      {/* Inline name editor overlay for frame names */}
      {editingNameNode && editingNamePosition && editingMode === "name" && (
        <InlineNameEditor
          node={editingNameNode}
          absoluteX={editingNamePosition.x}
          absoluteY={editingNamePosition.y}
        />
      )}
    </div>
  );
}
