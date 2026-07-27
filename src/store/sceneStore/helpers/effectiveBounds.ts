import type { FlatSceneNode, FlatFrameNode, FrameNode } from "../../../types/scene";
import { buildTree } from "../../../types/scene";
import { useLayoutStore } from "../../layoutStore";
import { calculateFrameIntrinsicSize } from "../../../utils/yogaLayout";
import type { SceneState } from "../types";

export type Bounds = { x: number; y: number; width: number; height: number };

/** Build a map of Yoga-computed positions for children of an auto-layout parent. */
export function buildLayoutMap(
  parentId: string | null | undefined,
  state: SceneState,
): Map<string, Bounds> {
  const layoutMap = new Map<string, Bounds>();
  if (!parentId) return layoutMap;

  const parentNode = state.nodesById[parentId];
  if (
    parentNode &&
    parentNode.type === "frame" &&
    (parentNode as FlatFrameNode).layout?.autoLayout
  ) {
    const calculateLayoutForFrame =
      useLayoutStore.getState().calculateLayoutForFrame;
    const parentTree = buildTree([parentId], state.nodesById, state.childrenById)[0] as FrameNode;
    const layoutNodes = calculateLayoutForFrame(parentTree);
    for (const ln of layoutNodes) {
      layoutMap.set(ln.id, { x: ln.x, y: ln.y, width: ln.width, height: ln.height });
    }
  }
  return layoutMap;
}

/**
 * Get effective bounds for a node, accounting for auto-layout and
 * fit-content frames. `layoutMap` should come from `buildLayoutMap` keyed by
 * the node's PARENT — pass an empty map when the parent isn't (yet)
 * auto-layout, in which case the node's own stored x/y/width/height already
 * are its visual position (manual layout has no separate "computed" pass).
 */
export function getEffectiveBounds(
  node: FlatSceneNode,
  layoutMap: Map<string, Bounds>,
  state: SceneState,
): Bounds {
  const layoutNode = layoutMap.get(node.id);
  const x = layoutNode?.x ?? node.x;
  const y = layoutNode?.y ?? node.y;
  let width = layoutNode?.width ?? node.width;
  let height = layoutNode?.height ?? node.height;

  if (node.type === "frame") {
    const frame = node as FlatFrameNode;
    if (frame.layout?.autoLayout) {
      const fitWidth = frame.sizing?.widthMode === "fit_content";
      const fitHeight = frame.sizing?.heightMode === "fit_content";
      if (fitWidth || fitHeight) {
        const frameTree = buildTree([node.id], state.nodesById, state.childrenById)[0] as FrameNode;
        const intrinsic = calculateFrameIntrinsicSize(frameTree, { fitWidth, fitHeight });
        if (fitWidth) width = intrinsic.width;
        if (fitHeight) height = intrinsic.height;
      }
    }
  }

  return { x, y, width, height };
}
