import { Container, Graphics, Text } from "pixi.js";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import type { TextNode } from "@/types/scene";
import type { OverlayHelpers } from "./helpers";
import { drawTextBaselines } from "./helpers";
import {
  COMPONENT_SELECTION_COLOR,
  HANDLE_FILL,
  HANDLE_SIZE,
  SELECTION_COLOR,
  SIZE_LABEL_BG_COMPONENT,
  SIZE_LABEL_BG_DEFAULT,
  SIZE_LABEL_CORNER_RADIUS,
  SIZE_LABEL_FONT_SIZE,
  SIZE_LABEL_OFFSET_Y,
  SIZE_LABEL_PADDING_X,
  SIZE_LABEL_PADDING_Y,
  SIZE_LABEL_STYLE,
  TEXT_BASELINE_COLOR,
} from "./constants";

export function redrawSelection(
  outlinesContainer: Container,
  handlesContainer: Container,
  sizeLabelsContainer: Container,
  selectionTextBaselines: Graphics,
  helpers: OverlayHelpers,
): void {
  const {
    selectedIds,
    editingNodeId,
    editingMode,
    instanceContext,
  } = useSelectionStore.getState();
  const scale = useViewportStore.getState().scale;
  const strokeWidth = 1 / scale;

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
    selectedIds.some((id) => helpers.isInComponentContext(id));
  const selectionBaselineColor = hasComponentSelection
    ? COMPONENT_SELECTION_COLOR
    : TEXT_BASELINE_COLOR;

  // Instance descendant selection — single outline + size label
  if (isInstanceDescendantSelection && instanceContext) {
    const target = helpers.getInstanceDescendantTarget(
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
        sizeLabelsContainer,
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

  // Draw outline for each selected node
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const id of selectedIds) {
    if (editingNodeId === id && editingMode === "text") continue;

    const node = state.nodesById[id];
    if (!node) continue;

    const drawRect = helpers.getNodeDrawRect(id);
    if (!drawRect) continue;

    const color = helpers.getSelectionColor(id);
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

    minX = Math.min(minX, drawRect.x);
    minY = Math.min(minY, drawRect.y);
    maxX = Math.max(maxX, drawRect.x + drawRect.width);
    maxY = Math.max(maxY, drawRect.y + drawRect.height);
  }

  if (minX === Infinity) return;

  const totalW = maxX - minX;
  const totalH = maxY - minY;
  const transformerColor = hasComponentSelection
    ? COMPONENT_SELECTION_COLOR
    : SELECTION_COLOR;

  // Multi-selection bounding box
  if (selectedIds.length > 1 && totalW > 0 && totalH > 0) {
    const multiOutline = new Graphics();
    multiOutline.rect(minX, minY, totalW, totalH);
    multiOutline.stroke({ color: transformerColor, width: strokeWidth });
    outlinesContainer.addChild(multiOutline);
  }

  // Transform handles at corners
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

  // Size label
  if (totalW > 0 && totalH > 0) {
    const isComp = selectedIds.some((id) => helpers.isInComponentContext(id));

    let badgeWidthMode: string | undefined;
    let badgeHeightMode: string | undefined;
    if (selectedIds.length === 1) {
      const singleNode = state.nodesById[selectedIds[0]];
      if (singleNode) {
        badgeWidthMode = singleNode.sizing?.widthMode;
        badgeHeightMode = singleNode.sizing?.heightMode;
      }
    } else {
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
      sizeLabelsContainer,
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

function drawSizeLabel(
  container: Container,
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

  const bg = new Graphics();
  bg.roundRect(-bgWidth / 2, 0, bgWidth, bgHeight, SIZE_LABEL_CORNER_RADIUS);
  bg.fill(bgColor);
  group.addChild(bg);

  text.position.set(-textWidth / 2, SIZE_LABEL_PADDING_Y);
  group.addChild(text);

  container.addChild(group);
}
