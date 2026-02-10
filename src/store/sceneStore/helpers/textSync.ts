import type { SceneNode, FlatSceneNode, TextNode } from "../../../types/scene";
import {
  measureTextAutoSize,
  measureTextFixedWidthHeight,
} from "../../../utils/textMeasure";
import { TEXT_MEASURE_PROPS } from "../types";

export function syncTextDimensions(node: FlatSceneNode): FlatSceneNode {
  if (node.type !== "text") return node;
  const textNode = node as TextNode;
  const mode = textNode.textWidthMode;

  if (!mode || mode === "auto") {
    const measured = measureTextAutoSize(textNode);
    return { ...textNode, width: measured.width, height: measured.height };
  } else if (mode === "fixed") {
    const measuredHeight = measureTextFixedWidthHeight(textNode);
    return { ...textNode, height: measuredHeight };
  }
  return textNode;
}

export function hasTextMeasureProps(updates: Partial<SceneNode>): boolean {
  return Object.keys(updates).some((k) => TEXT_MEASURE_PROPS.has(k));
}

/** Sync text dimensions for all text nodes in the flat store */
export function syncAllTextDimensionsFlat(
  nodesById: Record<string, FlatSceneNode>,
): Record<string, FlatSceneNode> {
  let changed = false;
  const result = { ...nodesById };
  for (const [id, node] of Object.entries(result)) {
    if (node.type === "text") {
      const synced = syncTextDimensions(node);
      if (synced !== node) {
        result[id] = synced;
        changed = true;
      }
    }
  }
  return changed ? result : nodesById;
}

/** This function will be called from the main store */
export function resyncAllTextNodeDimensionsInStore(
  getState: () => { nodesById: Record<string, FlatSceneNode> },
  setState: (state: { nodesById: Record<string, FlatSceneNode>; _cachedTree: null }) => void,
): void {
  const state = getState();
  const synced = syncAllTextDimensionsFlat(state.nodesById);
  if (synced !== state.nodesById) {
    setState({ nodesById: synced, _cachedTree: null });
  }
}
