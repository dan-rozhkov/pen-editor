import type {
  FrameNode,
  SceneNode,
} from "@/types/scene";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";

export interface PreparedFrameNode {
  layoutChildren: SceneNode[];
  effectiveWidth: number;
  effectiveHeight: number;
}

export function prepareFrameNode(
  frameNode: FrameNode,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): PreparedFrameNode {
  let layoutChildren: SceneNode[];
  if (frameNode.layout?.autoLayout) {
    const flowChildren = calculateLayoutForFrame(frameNode);
    // Include absolute-positioned children as-is (they keep their own x/y)
    const absoluteChildren = frameNode.children.filter(
      (c) => c.absolutePosition && c.visible !== false && c.enabled !== false,
    );
    layoutChildren = [...flowChildren, ...absoluteChildren];
  } else {
    layoutChildren = frameNode.children;
  }
  const fitWidth =
    frameNode.layout?.autoLayout && frameNode.sizing?.widthMode === "fit_content";
  const fitHeight =
    frameNode.layout?.autoLayout && frameNode.sizing?.heightMode === "fit_content";
  const intrinsicSize =
    fitWidth || fitHeight
      ? calculateFrameIntrinsicSize(frameNode, { fitWidth, fitHeight })
      : null;

  return {
    layoutChildren,
    effectiveWidth: fitWidth && intrinsicSize ? intrinsicSize.width : frameNode.width,
    effectiveHeight: fitHeight && intrinsicSize ? intrinsicSize.height : frameNode.height,
  };
}

export function getPreparedNodeEffectiveSize(
  node: SceneNode,
  _allNodes: SceneNode[],
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): { width: number; height: number } {
  if (node.type === "frame") {
    const prepared = prepareFrameNode(node, calculateLayoutForFrame);
    return {
      width: prepared.effectiveWidth,
      height: prepared.effectiveHeight,
    };
  }

  return { width: node.width, height: node.height };
}
