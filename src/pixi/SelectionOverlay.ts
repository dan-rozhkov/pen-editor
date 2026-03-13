import { CanvasTextMetrics, Container, Graphics, Text, TextStyle } from "pixi.js";
import { useSelectionStore } from "@/store/selectionStore";
import { useHoverStore } from "@/store/hoverStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { getNodeAbsolutePositionWithLayout, getNodeEffectiveSize } from "@/utils/nodeUtils";
import type {
  FlatSceneNode,
  FlatFrameNode,
  RefNode,
  SceneNode,
  TextNode,
} from "@/types/scene";
import { applyTextTransform } from "@/utils/textMeasure";
import { buildTextStyle } from "@/pixi/renderers/textRenderer";
import { truncateLabelToWidth } from "@/pixi/frameLabelUtils";
import { findResolvedDescendantByPath } from "@/utils/instanceRuntime";

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
    const nodes = useSceneStore.getState().getNodes();
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const layoutPos = getNodeAbsolutePositionWithLayout(
      nodes,
      nodeId,
      calculateLayoutForFrame,
    );
    if (layoutPos) return layoutPos;

    // Fallback to rendered bounds only if node is not found in the tree snapshot.
    const renderedRect = getRenderedNodeRect(nodeId);
    if (!renderedRect) return null;
    return { x: renderedRect.x, y: renderedRect.y };
  }

  function getEffectiveSize(nodeId: string): { width: number; height: number } | null {
    const state = useSceneStore.getState();
    const node = state.nodesById[nodeId];
    if (!node) return null;

    const sceneNodes = state.getNodes();
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const layoutSize = getNodeEffectiveSize(sceneNodes, nodeId, calculateLayoutForFrame);
    if (layoutSize) return layoutSize;

    // Fallback to rendered bounds only if layout lookup fails.
    const renderedRect = getRenderedNodeRect(nodeId);
    if (renderedRect) {
      return {
        width: renderedRect.width,
        height: renderedRect.height,
      };
    }

    return { width: node.width, height: node.height };
  }

  function getSelectionColor(nodeId: string): number {
    const state = useSceneStore.getState();
    const node = state.nodesById[nodeId];
    if (
      (node?.type === "frame" && (node as FlatFrameNode).reusable) ||
      node?.type === "ref"
    ) {
      return COMPONENT_SELECTION_COLOR;
    }
    return SELECTION_COLOR;
  }

  function getDrawRect(
    node: FlatSceneNode,
    absPos: { x: number; y: number },
    size: { width: number; height: number },
  ): { x: number; y: number; width: number; height: number } {
    if (node.type !== "embed") {
      return {
        x: absPos.x,
        y: absPos.y,
        width: size.width,
        height: size.height,
      };
    }
    return {
      x: Math.round(absPos.x),
      y: Math.round(absPos.y),
      width: Math.max(1, Math.round(size.width)),
      height: Math.max(1, Math.round(size.height)),
    };
  }

  function isComponentOrInstance(nodeId: string): boolean {
    const state = useSceneStore.getState();
    const node = state.nodesById[nodeId];
    return (
      (node?.type === "frame" && !!(node as FlatFrameNode).reusable) ||
      node?.type === "ref"
    );
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
    const metrics = CanvasTextMetrics.measureText(applyTextTransform(node.text ?? "", node.textTransform), style);
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

  function getInstanceDescendantTarget(
    instanceId: string,
    descendantPath: string,
  ): {
    instance: RefNode;
    node: SceneNode;
    drawRect: { x: number; y: number; width: number; height: number };
  } | null {
    const state = useSceneStore.getState();
    const instance = state.nodesById[instanceId];
    if (!instance || instance.type !== "ref") return null;

    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const resolved = findResolvedDescendantByPath(
      instance as RefNode,
      descendantPath,
      state.nodesById,
      state.childrenById,
      state.parentById,
      calculateLayoutForFrame,
    );
    if (!resolved) return null;

    const drawRect =
      resolved.node.type === "embed"
        ? {
            x: Math.round(resolved.absX),
            y: Math.round(resolved.absY),
            width: Math.max(1, Math.round(resolved.width)),
            height: Math.max(1, Math.round(resolved.height)),
          }
        : {
            x: resolved.absX,
            y: resolved.absY,
            width: resolved.width,
            height: resolved.height,
          };

    return {
      instance: instance as RefNode,
      node: resolved.node,
      drawRect,
    };
  }

  function redrawSelection(): void {
    const {
      selectedIds,
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
    const isInstanceDescendantSelection =
      !!instanceContext &&
      selectedIds.length === 1 &&
      selectedIds[0] === instanceContext.instanceId;
    const hasComponentSelection =
      !isInstanceDescendantSelection &&
      selectedIds.some((id) => isComponentOrInstance(id));
    const selectionBaselineColor = hasComponentSelection
      ? COMPONENT_SELECTION_COLOR
      : TEXT_BASELINE_COLOR;

    // Draw outline for each selected node
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let totalW = 0, totalH = 0;

    if (isInstanceDescendantSelection && instanceContext) {
      const target = getInstanceDescendantTarget(
        instanceContext.instanceId,
        instanceContext.descendantPath,
      );
      if (target) {
        const outline = new Graphics();
        outline.rect(
          target.drawRect.x,
          target.drawRect.y,
          target.drawRect.width,
          target.drawRect.height,
        );
        outline.stroke({ color: COMPONENT_SELECTION_COLOR, width: strokeWidth });
        outlinesContainer.addChild(outline);

        if (target.node.type === "text") {
          drawTextBaselines(
            selectionTextBaselines,
            target.node as TextNode,
            target.drawRect.x,
            target.drawRect.y,
            target.drawRect.width,
            scale,
            COMPONENT_SELECTION_COLOR,
          );
        }

        drawSizeLabel(
          target.drawRect.x + target.drawRect.width / 2,
          target.drawRect.y + target.drawRect.height,
          target.drawRect.width,
          target.drawRect.height,
          scale,
          true,
          target.node.sizing?.widthMode,
          target.node.sizing?.heightMode,
        );
      }
      return;
    }

    for (const id of selectedIds) {
      // Skip if editing text
      if (editingNodeId === id && editingMode === "text") continue;

      const node = state.nodesById[id];
      if (!node) continue;

      const absPos = getAbsolutePosition(id);
      if (!absPos) continue;

      // Get effective size (may differ from node.width/height for layout children)
      const effectiveSize = getEffectiveSize(id);
      const width = effectiveSize?.width ?? node.width;
      const height = effectiveSize?.height ?? node.height;
      const drawRect = getDrawRect(node, absPos, { width, height });

      const color = getSelectionColor(id);
      const outline = new Graphics();
      outline.rect(drawRect.x, drawRect.y, drawRect.width, drawRect.height);
      outline.stroke({ color, width: strokeWidth });
      outlinesContainer.addChild(outline);

      if (node.type === "text") {
        drawTextBaselines(
          selectionTextBaselines,
          node as TextNode,
          drawRect.x,
          drawRect.y,
          drawRect.width,
          scale,
          selectionBaselineColor,
        );
      }

      // Track bounding box for handles
      minX = Math.min(minX, drawRect.x);
      minY = Math.min(minY, drawRect.y);
      maxX = Math.max(maxX, drawRect.x + drawRect.width);
      maxY = Math.max(maxY, drawRect.y + drawRect.height);
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

        // Compute sizing modes for the badge label
        let badgeWidthMode: string | undefined;
        let badgeHeightMode: string | undefined;
        if (selectedIds.length === 1) {
          const singleNode = state.nodesById[selectedIds[0]];
          if (singleNode) {
            badgeWidthMode = singleNode.sizing?.widthMode;
            badgeHeightMode = singleNode.sizing?.heightMode;
          }
        } else {
          // Multi-select: show mode only if all selected nodes share the same mode
          const widthModes = new Set<string | undefined>();
          const heightModes = new Set<string | undefined>();
          for (const id of selectedIds) {
            const n = state.nodesById[id];
            if (n) {
              widthModes.add(n.sizing?.widthMode ?? "fixed");
              heightModes.add(n.sizing?.heightMode ?? "fixed");
            }
          }
          if (widthModes.size === 1) {
            const mode = [...widthModes][0];
            if (mode !== "fixed") badgeWidthMode = mode;
          }
          if (heightModes.size === 1) {
            const mode = [...heightModes][0];
            if (mode !== "fixed") badgeHeightMode = mode;
          }
        }

        drawSizeLabel(
          minX + totalW / 2,
          maxY,
          totalW,
          totalH,
          scale,
          isComp,
          badgeWidthMode,
          badgeHeightMode,
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
    widthMode?: string,
    heightMode?: string,
  ): void {
    const worldOffsetY = SIZE_LABEL_OFFSET_Y / scale;
    const widthLabel = widthMode === "fill_container" ? " Fill" : widthMode === "fit_content" ? " Fit" : "";
    const heightLabel = heightMode === "fill_container" ? " Fill" : heightMode === "fit_content" ? " Fit" : "";
    const displayText = `${Math.round(width)}${widthLabel} × ${Math.round(height)}${heightLabel}`;

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

    // Show frame names for top-level frames/groups/embeds only (to match Konva).
    const selectedSet = new Set(selectedIds);

    // Collect frame IDs to show names for
    const frameIds = new Set<string>();

    // Top-level frames always show names
    for (const rootId of state.rootIds) {
      const node = state.nodesById[rootId];
      if (
        node &&
        (node.type === "frame" ||
          node.type === "group" ||
          node.type === "embed") &&
        node.visible !== false &&
        node.enabled !== false
      ) {
        frameIds.add(rootId);
      }
    }

    for (const frameId of frameIds) {
      // Skip if editing this name
      if (editingNodeId === frameId && editingMode === "name") continue;

      const node = state.nodesById[frameId] as FlatSceneNode;
      if (!node) continue;

      // We only show names for root-level frames/groups.
      // Their absolute position matches root-space x/y directly.
      const absPos = { x: node.x, y: node.y };

      const isSelected = selectedSet.has(frameId);
      const isComponentNode =
        (node.type === "frame" && (node as FlatFrameNode).reusable) ||
        node.type === "ref";
      const labelColor = isComponentNode
        ? LABEL_COLOR_COMPONENT
        : isSelected
          ? LABEL_COLOR_SELECTED
          : LABEL_COLOR_NORMAL;

      const defaultName =
        node.type === "group" ? "Group" : node.type === "embed" ? "Embed" : "Frame";
      const fullName = node.name || defaultName;

      const worldOffsetY = (LABEL_FONT_SIZE + LABEL_OFFSET_Y) / scale;

      const style =
        labelColor === LABEL_COLOR_COMPONENT
          ? FRAME_NAME_STYLE_COMPONENT
          : labelColor === LABEL_COLOR_SELECTED
            ? FRAME_NAME_STYLE_SELECTED
            : FRAME_NAME_STYLE_NORMAL;
      const maxLabelWidthPx = Math.max(0, node.width * scale);
      const displayName = truncateLabelToWidth(fullName, maxLabelWidthPx, style);
      if (!displayName) continue;
      const text = new Text({ text: displayName, style });
      text.position.set(absPos.x, absPos.y - worldOffsetY);
      text.scale.set(1 / scale);

      frameNamesContainer.addChild(text);
    }
  }

  function redrawHover(): void {
    hovOutline.clear();
    hoverTextBaselines.clear();

    const { hoveredNodeId, hoveredInstanceId, hoveredDescendantPath } =
      useHoverStore.getState();
    const { selectedIds, instanceContext } = useSelectionStore.getState();

    if (hoveredDescendantPath && hoveredInstanceId) {
      if (
        instanceContext &&
        instanceContext.instanceId === hoveredInstanceId &&
        instanceContext.descendantPath === hoveredDescendantPath
      ) {
        return;
      }

      const target = getInstanceDescendantTarget(
        hoveredInstanceId,
        hoveredDescendantPath,
      );
      if (!target) return;

      const scale = useViewportStore.getState().scale;
      const strokeWidth = 1 / scale;
      hovOutline.rect(
        target.drawRect.x,
        target.drawRect.y,
        target.drawRect.width,
        target.drawRect.height,
      );
      hovOutline.stroke({ color: COMPONENT_SELECTION_COLOR, width: strokeWidth });

      if (target.node.type === "text") {
        drawTextBaselines(
          hoverTextBaselines,
          target.node as TextNode,
          target.drawRect.x,
          target.drawRect.y,
          target.drawRect.width,
          scale,
          COMPONENT_SELECTION_COLOR,
        );
      }
      return;
    }

    if (!hoveredNodeId) return;

    // Don't show hover on selected nodes
    if (selectedIds.includes(hoveredNodeId)) return;

    const state = useSceneStore.getState();
    const scale = useViewportStore.getState().scale;
    const strokeWidth = 1 / scale;

    const node = state.nodesById[hoveredNodeId];
    if (!node) return;

    const absPos = getAbsolutePosition(hoveredNodeId);
    if (!absPos) return;

    // Get effective size
    const effectiveSize = getEffectiveSize(hoveredNodeId);
    const width = effectiveSize?.width ?? node.width;
    const height = effectiveSize?.height ?? node.height;
    const drawRect = getDrawRect(node, absPos, { width, height });

    hovOutline.rect(drawRect.x, drawRect.y, drawRect.width, drawRect.height);
    const hoverColor = isComponentOrInstance(hoveredNodeId)
      ? COMPONENT_SELECTION_COLOR
      : HOVER_COLOR;
    hovOutline.stroke({ color: hoverColor, width: strokeWidth });

    if (node.type === "text") {
      const hoverBaselineColor = isComponentOrInstance(hoveredNodeId)
        ? COMPONENT_SELECTION_COLOR
        : TEXT_BASELINE_COLOR;
      drawTextBaselines(
        hoverTextBaselines,
        node as TextNode,
        drawRect.x,
        drawRect.y,
        drawRect.width,
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
