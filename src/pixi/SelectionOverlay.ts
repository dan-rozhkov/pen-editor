import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { useSelectionStore } from "@/store/selectionStore";
import { useHoverStore } from "@/store/hoverStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { getNodeAbsolutePositionWithLayout, getNodeEffectiveSize } from "@/utils/nodeUtils";
import type { FlatFrameNode, FlatGroupNode } from "@/types/scene";

const SELECTION_COLOR = 0x0d99ff;
const HOVER_COLOR = 0x0d99ff;
const COMPONENT_SELECTION_COLOR = 0x8b5cf6;
const HANDLE_SIZE = 8;
const HANDLE_FILL = 0xffffff;

// Frame name label constants
const LABEL_FONT_SIZE = 11;
const LABEL_OFFSET_Y = 4;
const LABEL_COLOR_NORMAL = "#666666";
const LABEL_COLOR_SELECTED = "#0d99ff";
const LABEL_COLOR_COMPONENT = "#9747ff";

// Size label constants
const SIZE_LABEL_FONT_SIZE = 11;
const SIZE_LABEL_OFFSET_Y = 6;
const SIZE_LABEL_PADDING_X = 6;
const SIZE_LABEL_PADDING_Y = 3;
const SIZE_LABEL_CORNER_RADIUS = 3;
const SIZE_LABEL_BG_DEFAULT = 0x0d99ff;
const SIZE_LABEL_BG_COMPONENT = 0x9747ff;
const SIZE_LABEL_TEXT_COLOR = "#ffffff";

/**
 * Create the selection overlay that draws selection outlines, transform handles,
 * frame name labels, and node size labels.
 * Returns a cleanup function.
 */
export function createSelectionOverlay(
  selectionContainer: Container,
  _sceneRoot: Container,
): () => void {
  const outlinesContainer = new Container();
  outlinesContainer.label = "selection-outlines";
  selectionContainer.addChild(outlinesContainer);

  const hovOutline = new Graphics();
  hovOutline.label = "hover-outline";
  selectionContainer.addChild(hovOutline);

  const handlesContainer = new Container();
  handlesContainer.label = "transform-handles";
  selectionContainer.addChild(handlesContainer);

  const frameNamesContainer = new Container();
  frameNamesContainer.label = "frame-names";
  selectionContainer.addChild(frameNamesContainer);

  const sizeLabelsContainer = new Container();
  sizeLabelsContainer.label = "size-labels";
  selectionContainer.addChild(sizeLabelsContainer);

  function getAbsolutePosition(nodeId: string): { x: number; y: number } | null {
    const nodes = useSceneStore.getState().getNodes();
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    return getNodeAbsolutePositionWithLayout(nodes, nodeId, calculateLayoutForFrame);
  }

  function getSelectionColor(nodeId: string): number {
    const state = useSceneStore.getState();
    let currentId: string | null = nodeId;
    while (currentId) {
      const node = state.nodesById[currentId];
      if (!node) break;
      if (node.type === "ref") return COMPONENT_SELECTION_COLOR;
      if (node.type === "frame" && (node as FlatFrameNode).reusable) {
        return COMPONENT_SELECTION_COLOR;
      }
      currentId = state.parentById[currentId] ?? null;
    }
    return SELECTION_COLOR;
  }

  function isComponentOrInstance(nodeId: string): boolean {
    const state = useSceneStore.getState();
    let currentId: string | null = nodeId;
    while (currentId) {
      const node = state.nodesById[currentId];
      if (!node) break;
      if (node.type === "ref") return true;
      if (node.type === "frame" && (node as FlatFrameNode).reusable) return true;
      currentId = state.parentById[currentId] ?? null;
    }
    return false;
  }

  function redrawSelection(): void {
    const { selectedIds, editingNodeId, editingMode } = useSelectionStore.getState();
    const scale = useViewportStore.getState().scale;
    const strokeWidth = 1 / scale;

    // Clear previous outlines and labels
    outlinesContainer.removeChildren();
    handlesContainer.removeChildren();
    sizeLabelsContainer.removeChildren();

    if (selectedIds.length === 0) return;

    const state = useSceneStore.getState();

    // Draw outline for each selected node
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let totalW = 0, totalH = 0;

    for (const id of selectedIds) {
      // Skip if editing text
      if (editingNodeId === id && editingMode === "text") continue;

      const node = state.nodesById[id];
      if (!node) continue;

      const absPos = getAbsolutePosition(id);
      if (!absPos) continue;

      // Get effective size (may differ from node.width/height for layout children)
      const nodes = useSceneStore.getState().getNodes();
      const effectiveSize = getNodeEffectiveSize(nodes, id, useLayoutStore.getState().calculateLayoutForFrame);
      const width = effectiveSize?.width ?? node.width;
      const height = effectiveSize?.height ?? node.height;

      const color = getSelectionColor(id);
      const outline = new Graphics();
      outline.rect(absPos.x, absPos.y, width, height);
      outline.stroke({ color, width: strokeWidth });
      outlinesContainer.addChild(outline);

      // Track bounding box for handles
      minX = Math.min(minX, absPos.x);
      minY = Math.min(minY, absPos.y);
      maxX = Math.max(maxX, absPos.x + width);
      maxY = Math.max(maxY, absPos.y + height);
    }

    totalW = maxX - minX;
    totalH = maxY - minY;
    const transformerColor = selectedIds.some((id) => isComponentOrInstance(id))
      ? COMPONENT_SELECTION_COLOR
      : SELECTION_COLOR;

    // Draw transform handles at corners of bounding box
    if (minX !== Infinity) {
      // For multi-selection, draw a single transformer bbox outline.
      if (selectedIds.length > 1 && totalW > 0 && totalH > 0) {
        const multiOutline = new Graphics();
        multiOutline.rect(minX, minY, totalW, totalH);
        multiOutline.stroke({ color: transformerColor, width: strokeWidth });
        outlinesContainer.addChild(multiOutline);
      }

      const handleSizeWorld = HANDLE_SIZE / scale;
      const halfHandle = handleSizeWorld / 2;

      const corners = [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: minX, y: maxY },
        { x: maxX, y: maxY },
      ];

      for (const corner of corners) {
        const handle = new Graphics();
        handle.rect(
          corner.x - halfHandle,
          corner.y - halfHandle,
          handleSizeWorld,
          handleSizeWorld,
        );
        handle.fill(HANDLE_FILL);
        handle.stroke({ color: transformerColor, width: strokeWidth });
        handlesContainer.addChild(handle);
      }


      // Draw size label below the selection bounding box
      if (totalW > 0 && totalH > 0) {
        const isComp = selectedIds.some((id) => isComponentOrInstance(id));
        drawSizeLabel(
          minX + totalW / 2,
          maxY,
          totalW,
          totalH,
          scale,
          isComp,
        );
      }
    }
  }

  function drawSizeLabel(
    centerX: number,
    bottomY: number,
    width: number,
    height: number,
    scale: number,
    isComponent: boolean,
  ): void {
    const worldOffsetY = SIZE_LABEL_OFFSET_Y / scale;
    const displayText = `${Math.round(width)} × ${Math.round(height)}`;

    const textStyle = new TextStyle({
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: SIZE_LABEL_FONT_SIZE,
      fill: SIZE_LABEL_TEXT_COLOR,
    });

    const text = new Text({ text: displayText, style: textStyle });
    const textWidth = text.width;

    const bgWidth = textWidth + SIZE_LABEL_PADDING_X * 2;
    const bgHeight = SIZE_LABEL_FONT_SIZE + SIZE_LABEL_PADDING_Y * 2;
    const bgColor = isComponent ? SIZE_LABEL_BG_COMPONENT : SIZE_LABEL_BG_DEFAULT;

    const group = new Container();
    group.position.set(centerX, bottomY + worldOffsetY);
    group.scale.set(1 / scale);

    // Background
    const bg = new Graphics();
    bg.roundRect(-bgWidth / 2, 0, bgWidth, bgHeight, SIZE_LABEL_CORNER_RADIUS);
    bg.fill(bgColor);
    group.addChild(bg);

    // Text
    text.position.set(-textWidth / 2, SIZE_LABEL_PADDING_Y);
    group.addChild(text);

    sizeLabelsContainer.addChild(group);
  }

  function redrawFrameNames(): void {
    frameNamesContainer.removeChildren();

    const state = useSceneStore.getState();
    const { selectedIds, editingNodeId, editingMode } = useSelectionStore.getState();
    const scale = useViewportStore.getState().scale;

    // Show frame names for top-level frames/groups only (to match Konva).
    const selectedSet = new Set(selectedIds);

    // Collect frame IDs to show names for
    const frameIds = new Set<string>();

    // Top-level frames always show names
    for (const rootId of state.rootIds) {
      const node = state.nodesById[rootId];
      if (node && (node.type === "frame" || node.type === "group") && node.visible !== false) {
        frameIds.add(rootId);
      }
    }

    for (const frameId of frameIds) {
      // Skip if editing this name
      if (editingNodeId === frameId && editingMode === "name") continue;

      const node = state.nodesById[frameId] as FlatFrameNode | FlatGroupNode;
      if (!node) continue;

      const absPos = getAbsolutePosition(frameId);
      if (!absPos) continue;

      const isSelected = selectedSet.has(frameId);
      const isReusable = node.type === "frame" && (node as FlatFrameNode).reusable;
      const labelColor = isReusable
        ? LABEL_COLOR_COMPONENT
        : isSelected
          ? LABEL_COLOR_SELECTED
          : LABEL_COLOR_NORMAL;

      const defaultName = node.type === "group" ? "Group" : "Frame";
      const displayName = node.name || defaultName;

      const worldOffsetY = (LABEL_FONT_SIZE + LABEL_OFFSET_Y) / scale;

      const textStyle = new TextStyle({
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: LABEL_FONT_SIZE,
        fill: labelColor,
      });

      const text = new Text({ text: displayName, style: textStyle });
      text.position.set(absPos.x, absPos.y - worldOffsetY);
      text.scale.set(1 / scale);

      frameNamesContainer.addChild(text);
    }
  }

  function redrawHover(): void {
    hovOutline.clear();

    const { hoveredNodeId } = useHoverStore.getState();
    if (!hoveredNodeId) return;

    // Don't show hover on selected nodes
    const { selectedIds } = useSelectionStore.getState();
    if (selectedIds.includes(hoveredNodeId)) return;

    const state = useSceneStore.getState();
    const node = state.nodesById[hoveredNodeId];
    if (!node) return;

    const absPos = getAbsolutePosition(hoveredNodeId);
    if (!absPos) return;

    // Get effective size
    const nodes = useSceneStore.getState().getNodes();
    const effectiveSize = getNodeEffectiveSize(nodes, hoveredNodeId, useLayoutStore.getState().calculateLayoutForFrame);
    const width = effectiveSize?.width ?? node.width;
    const height = effectiveSize?.height ?? node.height;

    const scale = useViewportStore.getState().scale;
    const strokeWidth = 1 / scale;

    hovOutline.rect(absPos.x, absPos.y, width, height);
    const hoverColor = isComponentOrInstance(hoveredNodeId)
      ? COMPONENT_SELECTION_COLOR
      : HOVER_COLOR;
    hovOutline.stroke({ color: hoverColor, width: strokeWidth });
  }

  // Subscribe to stores
  const unsubSelection = useSelectionStore.subscribe(() => {
    redrawSelection();
    redrawFrameNames();
    redrawHover();
  });

  const unsubHover = useHoverStore.subscribe(() => {
    redrawHover();
  });

  // Redraw selection when scene changes (node positions may have changed)
  const unsubScene = useSceneStore.subscribe(() => {
    redrawSelection();
    redrawFrameNames();
  });

  // Redraw when viewport changes (stroke width compensation)
  const unsubViewport = useViewportStore.subscribe(() => {
    redrawSelection();
    redrawFrameNames();
    redrawHover();
  });

  // Initial draw
  redrawSelection();
  redrawFrameNames();
  redrawHover();

  return () => {
    unsubSelection();
    unsubHover();
    unsubScene();
    unsubViewport();
    outlinesContainer.destroy({ children: true });
    hovOutline.destroy();
    handlesContainer.destroy({ children: true });
    frameNamesContainer.destroy({ children: true });
    sizeLabelsContainer.destroy({ children: true });
  };
}
