import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { Stage, Layer, Rect, Transformer } from "react-konva";
import Konva from "konva";
import { useViewportStore } from "../store/viewportStore";
import { useSceneStore } from "../store/sceneStore";
import { useSelectionStore } from "../store/selectionStore";
import { useHistoryStore } from "../store/historyStore";
import { useDragStore } from "../store/dragStore";
import { useClipboardStore } from "../store/clipboardStore";
import { RenderNode } from "./nodes/RenderNode";
import { DropIndicator } from "./DropIndicator";
import { InlineTextEditor } from "./InlineTextEditor";
import { InlineNameEditor } from "./InlineNameEditor";
import { FrameNameLabel } from "./nodes/FrameNameLabel";
import type { TextNode, FrameNode, SceneNode } from "../types/scene";
import { getViewportBounds, isNodeVisible } from "../utils/viewportUtils";
import { getNodeAbsolutePosition, getNodeAbsolutePositionWithLayout } from "../utils/nodeUtils";
import { useLayoutStore } from "../store/layoutStore";
import { generateId } from "../types/scene";

const ZOOM_FACTOR = 1.1;

export function Canvas() {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isMiddleMouseDown, setIsMiddleMouseDown] = useState(false);
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null);

  const {
    scale,
    x,
    y,
    isPanning,
    setPosition,
    setIsPanning,
    zoomAtPoint,
    fitToContent,
  } = useViewportStore();
  const nodes = useSceneStore((state) => state.nodes);
  const addNode = useSceneStore((state) => state.addNode);
  const { copiedNode, copyNode } = useClipboardStore();
  const calculateLayoutForFrame = useLayoutStore((state) => state.calculateLayoutForFrame);

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
  const setNodesWithoutHistory = useSceneStore(
    (state) => state.setNodesWithoutHistory,
  );
  const {
    selectedIds,
    clearSelection,
    editingNodeId,
    editingMode,
    isSelected,
    exitInstanceEditMode,
  } = useSelectionStore();
  const { undo, redo, saveHistory, startBatch, endBatch } = useHistoryStore();
  const dropIndicator = useDragStore((state) => state.dropIndicator);

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
      if (node.type === "frame" && node.children) {
        const found = findNodeByIdGeneric(node.children, id);
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

  // Determine transformer color based on whether a component is selected
  const transformerColor = useMemo(() => {
    const defaultColor = "#0d99ff"; // Blue
    const componentColor = "#9747ff"; // Purple (Figma component color)

    // Check if any selected node is a reusable component
    for (const id of selectedIds) {
      const node = findNodeByIdGeneric(nodes, id);
      if (node && node.type === "frame" && (node as FrameNode).reusable) {
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
    ? getNodeAbsolutePositionWithLayout(nodes, editingTextNode.id, calculateLayoutForFrame)
    : null;

  // Collect all frame nodes with their absolute positions for rendering labels
  const collectFrameNodes = useMemo(() => {
    const frames: Array<{ node: FrameNode; absX: number; absY: number; isNested: boolean }> = [];

    const traverse = (searchNodes: SceneNode[], accX: number, accY: number, isNested: boolean) => {
      for (const node of searchNodes) {
        if (node.type === "frame") {
          frames.push({
            node,
            absX: accX + node.x,
            absY: accY + node.y,
            isNested,
          });
          // Recursively collect nested frames (mark them as nested)
          traverse(node.children, accX + node.x, accY + node.y, true);
        }
      }
    };

    traverse(visibleNodes, 0, 0, false);
    return frames;
  }, [visibleNodes]);

  // Update transformer nodes when selection changes
  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;

    // Find selected nodes on stage
    const selectedNodes: Konva.Node[] = [];
    selectedIds.forEach((id) => {
      const node = stage.findOne(`#${id}`);
      if (node) {
        selectedNodes.push(node);
      }
    });

    transformer.nodes(selectedNodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedIds]);

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

  // Keyboard event handlers for spacebar panning, deletion, undo/redo, and escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input field
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

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

      // Escape - exit instance edit mode first, then clear selection
      if (e.code === "Escape") {
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
  ]);

  // Mouse wheel handler (Figma-style)
  // - Scroll = pan vertically
  // - Shift + scroll = pan horizontally
  // - Cmd/Ctrl + scroll = zoom
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();

      const stage = stageRef.current;
      if (!stage) return;

      // Cmd/Ctrl + scroll = zoom
      if (e.evt.metaKey || e.evt.ctrlKey) {
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;

        const direction = e.evt.deltaY > 0 ? -1 : 1;
        const newScale =
          direction > 0 ? scale * ZOOM_FACTOR : scale / ZOOM_FACTOR;

        zoomAtPoint(newScale, pointerPos.x, pointerPos.y);
      } else {
        // Normal scroll = pan
        // Shift + scroll = horizontal pan
        const dx = e.evt.shiftKey ? -e.evt.deltaY : -e.evt.deltaX;
        const dy = e.evt.shiftKey ? 0 : -e.evt.deltaY;

        setPosition(x + dx, y + dy);
      }
    },
    [scale, x, y, zoomAtPoint, setPosition],
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
        // Left click on empty space - clear selection
        const clickedOnEmpty =
          e.target === e.target.getStage() || e.target.name() === "background";
        if (clickedOnEmpty) {
          clearSelection();
        }
      }
    },
    [isSpacePressed, setIsPanning, clearSelection],
  );

  const handleMouseMove = useCallback(() => {
    if (!isPanning || !lastPointerPosition.current) return;

    const stage = stageRef.current;
    if (!stage) return;

    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    const dx = pointerPos.x - lastPointerPosition.current.x;
    const dy = pointerPos.y - lastPointerPosition.current.y;

    setPosition(x + dx, y + dy);
    lastPointerPosition.current = pointerPos;
  }, [isPanning, x, y, setPosition]);

  const handleMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 1) {
        setIsMiddleMouseDown(false);
        if (!isSpacePressed) {
          setIsPanning(false);
        }
      }
      lastPointerPosition.current = null;
    },
    [isSpacePressed, setIsPanning],
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
        cursor: isPanning ? "grab" : "default",
        background: "#f5f5f5",
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
            anchorSize={8}
            anchorCornerRadius={2}
            borderStroke={transformerColor}
            anchorStroke={transformerColor}
            anchorFill="#ffffff"
            rotateEnabled={false}
          />
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
