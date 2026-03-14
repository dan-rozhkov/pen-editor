import { Graphics } from "pixi.js";
import { useHoverStore } from "@/store/hoverStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import type { TextNode } from "@/types/scene";
import type { OverlayHelpers } from "./helpers";
import { drawTextBaselines, drawDashedRect } from "./helpers";
import { COMPONENT_SELECTION_COLOR, HOVER_COLOR, TEXT_BASELINE_COLOR } from "./constants";

export function redrawHover(
  hovOutline: Graphics,
  childOutlines: Graphics,
  hoverTextBaselines: Graphics,
  helpers: OverlayHelpers,
): void {
  hovOutline.clear();
  hoverTextBaselines.clear();
  childOutlines.clear();

  const { hoveredNodeId, hoveredInstanceId, hoveredDescendantPath } =
    useHoverStore.getState();
  const { selectedIds, instanceContext } = useSelectionStore.getState();

  // Instance descendant hover
  if (hoveredDescendantPath && hoveredInstanceId) {
    if (
      instanceContext &&
      instanceContext.instanceId === hoveredInstanceId &&
      instanceContext.descendantPath === hoveredDescendantPath
    ) {
      return;
    }

    const target = helpers.getInstanceDescendantTarget(
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

  // When hovering a selected node, show dotted outlines on its direct children
  if (selectedIds.includes(hoveredNodeId)) {
    const state = useSceneStore.getState();
    const children = state.childrenById[hoveredNodeId];
    if (children && children.length > 0) {
      const scale = useViewportStore.getState().scale;
      const color = helpers.getSelectionColor(hoveredNodeId);
      for (const childId of children) {
        const childNode = state.nodesById[childId];
        if (!childNode || childNode.visible === false) continue;
        const childRect = helpers.getNodeDrawRect(childId);
        if (!childRect) continue;
        drawDashedRect(childOutlines, childRect, color, scale);
      }
    }
    return;
  }

  // Regular hover outline
  const node = useSceneStore.getState().nodesById[hoveredNodeId];
  if (!node) return;

  const drawRect = helpers.getNodeDrawRect(hoveredNodeId);
  if (!drawRect) return;

  const scale = useViewportStore.getState().scale;
  const hoverColor = helpers.isInComponentContext(hoveredNodeId)
    ? COMPONENT_SELECTION_COLOR
    : HOVER_COLOR;
  hovOutline.rect(drawRect.x, drawRect.y, drawRect.width, drawRect.height);
  hovOutline.stroke({ color: hoverColor, width: 1 / scale });

  if (node.type === "text") {
    const hoverBaselineColor = helpers.isInComponentContext(hoveredNodeId)
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
