import { Container, Text } from "pixi.js";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import type { FlatFrameNode, FlatSceneNode } from "@/types/scene";
import { truncateLabelToWidth } from "@/pixi/frameLabelUtils";
import {
  FRAME_NAME_STYLE_COMPONENT,
  FRAME_NAME_STYLE_NORMAL,
  FRAME_NAME_STYLE_SELECTED,
  LABEL_COLOR_COMPONENT,
  LABEL_COLOR_NORMAL,
  LABEL_COLOR_SELECTED,
  LABEL_FONT_SIZE,
  LABEL_OFFSET_Y,
} from "./constants";

export function redrawFrameNames(frameNamesContainer: Container): void {
  frameNamesContainer.removeChildren();

  const state = useSceneStore.getState();
  const { selectedIds, editingNodeId, editingMode } = useSelectionStore.getState();
  const scale = useViewportStore.getState().scale;

  const selectedSet = new Set(selectedIds);
  const frameIds = new Set<string>();

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
    if (editingNodeId === frameId && editingMode === "name") continue;

    const node = state.nodesById[frameId] as FlatSceneNode;
    if (!node) continue;

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
