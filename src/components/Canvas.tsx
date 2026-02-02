import { useRef, useEffect, useState, useMemo } from "react";
import { Stage, Layer, Rect, Transformer } from "react-konva";
import Konva from "konva";
import { DropIndicator } from "@/components/DropIndicator";
import { InlineNameEditor } from "@/components/InlineNameEditor";
import { InlineTextEditor } from "@/components/InlineTextEditor";
import { MeasureOverlay } from "@/components/MeasureOverlay";
import { SmartGuides } from "@/components/SmartGuides";
import { FrameNameLabel } from "@/components/nodes/FrameNameLabel";
import { NodeSizeLabel } from "@/components/nodes/NodeSizeLabel";
import { RenderNode } from "@/components/nodes/RenderNode";
import { useCanvasDoubleClick } from "@/components/canvas/useCanvasDoubleClick";
import { useCanvasFileDrop } from "@/components/canvas/useCanvasFileDrop";
import { useCanvasKeyboardShortcuts } from "@/components/canvas/useCanvasKeyboardShortcuts";
import { useCanvasPointerHandlers } from "@/components/canvas/useCanvasPointerHandlers";
import { useCanvasSelectionData } from "@/components/canvas/useCanvasSelectionData";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useClipboardStore } from "@/store/clipboardStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useMeasureStore } from "@/store/measureStore";
import { useDragStore } from "@/store/dragStore";
import { useHistoryStore } from "@/store/historyStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { getViewportBounds, isNodeVisible } from "@/utils/viewportUtils";

export function Canvas() {
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isMiddleMouseDown, setIsMiddleMouseDown] = useState(false);

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
  const addChildToFrame = useSceneStore((state) => state.addChildToFrame);
  const { copiedNodes, copyNodes } = useClipboardStore();
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
    enterContainer,
    select,
  } = useSelectionStore();
  const { undo, redo, saveHistory, startBatch, endBatch } = useHistoryStore();
  const dropIndicator = useDragStore((state) => state.dropIndicator);
  const { activeTool, cancelDrawing, toggleTool } = useDrawModeStore();

  const {
    editingTextNode,
    editingNameNode,
    editingTextPosition,
    editingNamePosition,
    transformerColor,
    collectFrameNodes,
    collectSelectedNodes,
    selectionBoundingBox,
  } = useCanvasSelectionData({
    nodes,
    visibleNodes,
    selectedIds,
    editingNodeId,
    editingMode,
    calculateLayoutForFrame,
  });

  useCanvasKeyboardShortcuts({
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
    copyNodes,
  });

  const {
    drawPreviewRect,
    marqueeRect,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleContextMenu,
  } = useCanvasPointerHandlers({
    stageRef,
    isPanning,
    setIsPanning,
    setPosition,
    x,
    y,
    startSmoothZoom,
    isSpacePressed,
    setIsMiddleMouseDown,
    clearSelection,
    resetContainerContext,
    setSelectedIds,
    addNode,
  });

  useCanvasDoubleClick({
    containerRef,
    stageRef,
    enterContainer,
    select,
  });

  useCanvasFileDrop({
    containerRef,
    addNode,
  });

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

  // Track Alt/Option modifier key for distance measurement overlay
  useEffect(() => {
    const { setModifierHeld, clearLines } = useMeasureStore.getState();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        setModifierHeld(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        setModifierHeld(false);
        clearLines();
      }
    };
    const handleBlur = () => {
      setModifierHeld(false);
      clearLines();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-canvas
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
          {/* Smart guides for snapping during drag */}
          <SmartGuides />
          {/* Distance measurement overlay (Option + hover) */}
          <MeasureOverlay />
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
