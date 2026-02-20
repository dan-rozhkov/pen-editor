import { CanvasTextMetrics, Container, Graphics, Text, TextStyle } from "pixi.js";
import { useSelectionStore } from "@/store/selectionStore";
import { useHoverStore } from "@/store/hoverStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { getNodeAbsolutePositionWithLayout, getNodeEffectiveSize } from "@/utils/nodeUtils";
import type {
  FlatFrameNode,
  FlatGroupNode,
  RefNode,
  TextNode,
} from "@/types/scene";
import { findDescendantLocalRect, prepareInstanceNode } from "@/utils/instanceUtils";
import { findNodeById } from "@/utils/nodeUtils";
import { findDescendantByPath, findDescendantRectByPath } from "@/utils/instancePathUtils";
import { buildTextStyle } from "@/pixi/renderers/textRenderer";

const SELECTION_COLOR = 0x0d99ff;
const HOVER_COLOR = 0x0d99ff;
const COMPONENT_SELECTION_COLOR = 0x8b5cf6;
const TEXT_BASELINE_COLOR = 0x0d99ff;
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
const SIZE_LABEL_STYLE = new TextStyle({
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: SIZE_LABEL_FONT_SIZE,
  fill: SIZE_LABEL_TEXT_COLOR,
});
const FRAME_NAME_STYLE_NORMAL = new TextStyle({
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: LABEL_FONT_SIZE,
  fill: LABEL_COLOR_NORMAL,
});
const FRAME_NAME_STYLE_SELECTED = new TextStyle({
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: LABEL_FONT_SIZE,
  fill: LABEL_COLOR_SELECTED,
});
const FRAME_NAME_STYLE_COMPONENT = new TextStyle({
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: LABEL_FONT_SIZE,
  fill: LABEL_COLOR_COMPONENT,
});

/**
 * Create the selection overlay that draws selection outlines, transform handles,
 * frame name labels, and node size labels.
 * Returns a cleanup function.
 */
export function createSelectionOverlay(
  selectionContainer: Container,
  sceneRoot: Container,
): () => void {
  const outlinesContainer = new Container();
  outlinesContainer.label = "selection-outlines";
  selectionContainer.addChild(outlinesContainer);

  const hovOutline = new Graphics();
  hovOutline.label = "hover-outline";
  selectionContainer.addChild(hovOutline);

  const selectionTextBaselines = new Graphics();
  selectionTextBaselines.label = "selection-text-baselines";
  selectionContainer.addChild(selectionTextBaselines);

  const hoverTextBaselines = new Graphics();
  hoverTextBaselines.label = "hover-text-baselines";
  selectionContainer.addChild(hoverTextBaselines);

  const handlesContainer = new Container();
  handlesContainer.label = "transform-handles";
  selectionContainer.addChild(handlesContainer);

  const frameNamesContainer = new Container();
  frameNamesContainer.label = "frame-names";
  selectionContainer.addChild(frameNamesContainer);

  const sizeLabelsContainer = new Container();
  sizeLabelsContainer.label = "size-labels";
  selectionContainer.addChild(sizeLabelsContainer);
  let lastScale = useViewportStore.getState().scale;

  function findNodeContainerById(
    root: Container,
    nodeId: string,
  ): Container | null {
    for (const child of root.children) {
      if (!(child instanceof Container)) continue;
      if (child.label === nodeId) return child;
      const found = findNodeContainerById(child, nodeId);
      if (found) return found;
    }
    return null;
  }

  function getRenderedNodeRect(
    nodeId: string,
  ): { x: number; y: number; width: number; height: number } | null {
    const nodeContainer = findNodeContainerById(sceneRoot, nodeId);
    if (!nodeContainer) return null;
    const b = nodeContainer.getBounds();
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.width) || !Number.isFinite(b.height)) {
      return null;
    }
    const { x: viewportX, y: viewportY, scale } = useViewportStore.getState();
    const safeScale = scale || 1;
    return {
      x: (b.x - viewportX) / safeScale,
      y: (b.y - viewportY) / safeScale,
      width: b.width / safeScale,
      height: b.height / safeScale,
    };
  }

  function getAbsolutePosition(nodeId: string): { x: number; y: number } | null {
    const flatNode = useSceneStore.getState().nodesById[nodeId];
    if (flatNode?.type === "ref") {
      const renderedRect = getRenderedNodeRect(nodeId);
      if (renderedRect) return { x: renderedRect.x, y: renderedRect.y };
    }
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

  function drawTextBaselines(
    gfx: Graphics,
    node: TextNode,
    absX: number,
    absY: number,
    width: number,
    scale: number,
    color: number,
  ): void {
    const style = buildTextStyle(node);
    const metrics = CanvasTextMetrics.measureText(node.text ?? "", style);
    const lineWidths = metrics.lineWidths ?? [];
    const lineCount = Math.max(1, metrics.lines?.length ?? 0);
    const lineHeight =
      metrics.lineHeight || (node.fontSize ?? 16) * (node.lineHeight ?? 1.2);
    const fontAscent = metrics.fontProperties?.ascent ?? (node.fontSize ?? 16) * 0.8;
    const fontPixelSize =
      metrics.fontProperties?.fontSize ?? (node.fontSize ?? 16);
    // Pixi renders extra leading around glyphs when lineHeight > fontSize.
    // Baseline should include the top half of that leading to match visual text position.
    const baselineOffset = fontAscent + Math.max(0, (lineHeight - fontPixelSize) / 2);
    const textAlign = node.textAlign ?? "left";
    const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : width;
    const textBoxWidth =
      node.textWidthMode === "fixed" || node.textWidthMode === "fixed-height"
        ? width
        : maxLineWidth;

    for (let i = 0; i < lineCount; i++) {
      const lineWidth = lineWidths[i] ?? 0;
      if (lineWidth <= 0) continue;

      let lineX = absX;
      if (textAlign === "center") {
        lineX += (textBoxWidth - lineWidth) / 2;
      } else if (textAlign === "right") {
        lineX += textBoxWidth - lineWidth;
      }

      const lineY = absY + i * lineHeight + baselineOffset;
      gfx.moveTo(lineX, lineY);
      gfx.lineTo(lineX + lineWidth, lineY);
      gfx.stroke({ color, width: 1 / scale });
    }
  }

  function redrawSelection(): void {
    const {
      selectedIds,
      selectedDescendantIds,
      editingNodeId,
      editingMode,
      instanceContext,
    } = useSelectionStore.getState();
    const scale = useViewportStore.getState().scale;
    const strokeWidth = 1 / scale;

    // Clear previous outlines and labels
    outlinesContainer.removeChildren();
    handlesContainer.removeChildren();
    sizeLabelsContainer.removeChildren();
    selectionTextBaselines.clear();

    if (selectedIds.length === 0) return;

    const state = useSceneStore.getState();
    const sceneNodes = state.getNodes();
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const hasComponentSelection = selectedIds.some((id) => isComponentOrInstance(id));
    const selectionBaselineColor = hasComponentSelection
      ? COMPONENT_SELECTION_COLOR
      : TEXT_BASELINE_COLOR;

    // Instance descendant selection: draw outline at descendant position
    if (instanceContext) {
      const { instanceId, descendantId, descendantPath } = instanceContext;
      // Skip drawing if descendant text is being edited
      if (editingMode === "text") return;

      const instanceAbsPos = getAbsolutePosition(instanceId);
      if (!instanceAbsPos) return;

      const allNodes = state.getNodes();
      const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
      const instanceNode = findNodeById(allNodes, instanceId);
      if (!instanceNode || instanceNode.type !== "ref") return;

      const prepared = prepareInstanceNode(instanceNode as unknown as RefNode, allNodes, calculateLayoutForFrame);
      if (!prepared) return;

      const descendantIds =
        selectedDescendantIds.length > 0
          ? selectedDescendantIds
          : [descendantId];
      const rectEntries = descendantIds
        .map((id, index) => ({
          id,
          rect:
            index === 0 && descendantPath
              ? findDescendantRectByPath(prepared.layoutChildren, descendantPath)
              : findDescendantLocalRect(prepared.layoutChildren, id),
        }))
        .filter(
          (
            entry,
          ): entry is { id: string; rect: NonNullable<typeof entry.rect> } =>
            entry.rect != null,
        );
      const rects = rectEntries.map((entry) => entry.rect);
      if (rects.length === 0) return;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const entry of rectEntries) {
        const { id: descendantId, rect } = entry;
        const absX = instanceAbsPos.x + rect.x;
        const absY = instanceAbsPos.y + rect.y;
        const { width, height } = rect;
        minX = Math.min(minX, absX);
        minY = Math.min(minY, absY);
        maxX = Math.max(maxX, absX + width);
        maxY = Math.max(maxY, absY + height);

        // Draw per-descendant outline
        const outline = new Graphics();
        outline.rect(absX, absY, width, height);
        outline.stroke({ color: COMPONENT_SELECTION_COLOR, width: strokeWidth });
        outlinesContainer.addChild(outline);

        const descendant =
          descendantPath && descendantId === instanceContext.descendantId
            ? findDescendantByPath(prepared.layoutChildren, descendantPath)
            : findNodeById(prepared.layoutChildren, descendantId);
        if (descendant?.type === "text") {
          drawTextBaselines(
            selectionTextBaselines,
            descendant as TextNode,
            absX,
            absY,
            width,
            scale,
            selectionBaselineColor,
          );
        }
      }

      const width = maxX - minX;
      const height = maxY - minY;
      if (width <= 0 || height <= 0) return;

      // Draw multi-selection bbox outline for descendants
      if (rects.length > 1) {
        const multiOutline = new Graphics();
        multiOutline.rect(minX, minY, width, height);
        multiOutline.stroke({ color: COMPONENT_SELECTION_COLOR, width: strokeWidth });
        outlinesContainer.addChild(multiOutline);
      }

      // Draw transform handles at descendant corners
      const handleSizeWorld = HANDLE_SIZE / scale;
      const halfHandle = handleSizeWorld / 2;
      const corners = [
        { x: minX, y: minY },
        { x: minX + width, y: minY },
        { x: minX, y: minY + height },
        { x: minX + width, y: minY + height },
      ];
      for (const corner of corners) {
        const handle = new Graphics();
        handle.rect(corner.x - halfHandle, corner.y - halfHandle, handleSizeWorld, handleSizeWorld);
        handle.fill(HANDLE_FILL);
        handle.stroke({ color: COMPONENT_SELECTION_COLOR, width: strokeWidth });
        handlesContainer.addChild(handle);
      }

      // Draw size label for descendant
      drawSizeLabel(minX + width / 2, minY + height, width, height, scale, true);
      return;
    }

    // Draw outline for each selected node
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let totalW = 0, totalH = 0;

    for (const id of selectedIds) {
      // Skip if editing text
      if (editingNodeId === id && editingMode === "text") continue;

      const node = state.nodesById[id];
      if (!node) continue;

      const renderedRect = node.type === "ref" ? getRenderedNodeRect(id) : null;
      const absPos = renderedRect
        ? { x: renderedRect.x, y: renderedRect.y }
        : getNodeAbsolutePositionWithLayout(sceneNodes, id, calculateLayoutForFrame);
      if (!absPos) continue;

      // Get effective size (may differ from node.width/height for layout children)
      const effectiveSize = renderedRect
        ? { width: renderedRect.width, height: renderedRect.height }
        : getNodeEffectiveSize(sceneNodes, id, calculateLayoutForFrame);
      const width = effectiveSize?.width ?? node.width;
      const height = effectiveSize?.height ?? node.height;

      const color = getSelectionColor(id);
      const outline = new Graphics();
      outline.rect(absPos.x, absPos.y, width, height);
      outline.stroke({ color, width: strokeWidth });
      outlinesContainer.addChild(outline);

      if (node.type === "text") {
        drawTextBaselines(
          selectionTextBaselines,
          node as TextNode,
          absPos.x,
          absPos.y,
          width,
          scale,
          selectionBaselineColor,
        );
      }

      // Track bounding box for handles
      minX = Math.min(minX, absPos.x);
      minY = Math.min(minY, absPos.y);
      maxX = Math.max(maxX, absPos.x + width);
      maxY = Math.max(maxY, absPos.y + height);
    }

    totalW = maxX - minX;
    totalH = maxY - minY;
    const transformerColor = hasComponentSelection
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

    const text = new Text({ text: displayText, style: SIZE_LABEL_STYLE });
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
      if (
        node &&
        (node.type === "frame" || node.type === "group") &&
        node.visible !== false &&
        node.enabled !== false
      ) {
        frameIds.add(rootId);
      }
    }

    for (const frameId of frameIds) {
      // Skip if editing this name
      if (editingNodeId === frameId && editingMode === "name") continue;

      const node = state.nodesById[frameId] as FlatFrameNode | FlatGroupNode;
      if (!node) continue;

      // We only show names for root-level frames/groups.
      // Their absolute position matches root-space x/y directly.
      const absPos = { x: node.x, y: node.y };

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

      const style =
        labelColor === LABEL_COLOR_COMPONENT
          ? FRAME_NAME_STYLE_COMPONENT
          : labelColor === LABEL_COLOR_SELECTED
            ? FRAME_NAME_STYLE_SELECTED
            : FRAME_NAME_STYLE_NORMAL;
      const text = new Text({ text: displayName, style });
      text.position.set(absPos.x, absPos.y - worldOffsetY);
      text.scale.set(1 / scale);

      frameNamesContainer.addChild(text);
    }
  }

  function redrawHover(): void {
    hovOutline.clear();
    hoverTextBaselines.clear();

    const { hoveredNodeId, hoveredInstanceId } = useHoverStore.getState();
    if (!hoveredNodeId) return;

    // Don't show hover on selected nodes
    const { selectedIds } = useSelectionStore.getState();

    const state = useSceneStore.getState();
    const scale = useViewportStore.getState().scale;
    const strokeWidth = 1 / scale;
    const hoverBaselineColor = hoveredInstanceId
      ? COMPONENT_SELECTION_COLOR
      : isComponentOrInstance(hoveredNodeId)
        ? COMPONENT_SELECTION_COLOR
        : TEXT_BASELINE_COLOR;

    // Instance descendant hover
    if (hoveredInstanceId) {
      if (selectedIds.includes(hoveredInstanceId)) {
        const { instanceContext, selectedDescendantIds } = useSelectionStore.getState();
        if (
          instanceContext?.instanceId === hoveredInstanceId &&
          (selectedDescendantIds.length > 0
            ? selectedDescendantIds.includes(hoveredNodeId)
            : instanceContext?.descendantId === hoveredNodeId)
        ) {
          return;
        }
      }

      const instanceNode = state.nodesById[hoveredInstanceId];
      if (!instanceNode || instanceNode.type !== "ref") return;

      const instanceAbsPos = getAbsolutePosition(hoveredInstanceId);
      if (!instanceAbsPos) return;

      const nodes = state.getNodes();
      const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
      const prepared = prepareInstanceNode(instanceNode as unknown as RefNode, nodes, calculateLayoutForFrame);
      if (!prepared) return;

      const rect = findDescendantLocalRect(prepared.layoutChildren, hoveredNodeId);
      if (!rect) return;

      hovOutline.rect(instanceAbsPos.x + rect.x, instanceAbsPos.y + rect.y, rect.width, rect.height);
      hovOutline.stroke({ color: COMPONENT_SELECTION_COLOR, width: strokeWidth });

      const descendant = findNodeById(prepared.layoutChildren, hoveredNodeId);
      if (descendant?.type === "text") {
        drawTextBaselines(
          hoverTextBaselines,
          descendant as TextNode,
          instanceAbsPos.x + rect.x,
          instanceAbsPos.y + rect.y,
          rect.width,
          scale,
          hoverBaselineColor,
        );
      }
      return;
    }

    if (selectedIds.includes(hoveredNodeId)) return;

    const node = state.nodesById[hoveredNodeId];
    if (!node) return;

    const renderedRect = node.type === "ref" ? getRenderedNodeRect(hoveredNodeId) : null;
    const absPos = renderedRect
      ? { x: renderedRect.x, y: renderedRect.y }
      : getAbsolutePosition(hoveredNodeId);
    if (!absPos) return;

    // Get effective size
    const nodes = useSceneStore.getState().getNodes();
    const effectiveSize = renderedRect
      ? { width: renderedRect.width, height: renderedRect.height }
      : getNodeEffectiveSize(nodes, hoveredNodeId, useLayoutStore.getState().calculateLayoutForFrame);
    const width = effectiveSize?.width ?? node.width;
    const height = effectiveSize?.height ?? node.height;

    hovOutline.rect(absPos.x, absPos.y, width, height);
    const hoverColor = isComponentOrInstance(hoveredNodeId)
      ? COMPONENT_SELECTION_COLOR
      : HOVER_COLOR;
    hovOutline.stroke({ color: hoverColor, width: strokeWidth });

    if (node.type === "text") {
      drawTextBaselines(
        hoverTextBaselines,
        node as TextNode,
        absPos.x,
        absPos.y,
        width,
        scale,
        hoverBaselineColor,
      );
    }
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
    const currentScale = useViewportStore.getState().scale;
    if (currentScale === lastScale) return;
    lastScale = currentScale;
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
    selectionTextBaselines.destroy();
    hoverTextBaselines.destroy();
    handlesContainer.destroy({ children: true });
    frameNamesContainer.destroy({ children: true });
    sizeLabelsContainer.destroy({ children: true });
  };
}
