import {
  findChildAtPosition,
  getNodeAbsolutePositionWithLayout,
} from "@/utils/nodeUtils";
import { prepareFrameNode } from "@/utils/instanceUtils";
import type { SceneNode, FrameNode, GroupNode } from "@/types/scene";

type CalculateLayoutForFrame = Parameters<typeof prepareFrameNode>[1];

/**
 * Figma-style drill: the DIRECT child of `container` under the world point
 * (topmost in z-order), or null when the point hits no child. One drill
 * level per call — never the deepest descendant.
 */
export function resolveDrillChild(
  container: FrameNode | GroupNode,
  worldX: number,
  worldY: number,
  nodes: SceneNode[],
  calculateLayoutForFrame: CalculateLayoutForFrame,
): string | null {
  const absPos = getNodeAbsolutePositionWithLayout(
    nodes,
    container.id,
    calculateLayoutForFrame,
  );
  if (!absPos) return null;
  const hitChildren =
    container.type === "frame" && container.layout?.autoLayout
      ? prepareFrameNode(container, calculateLayoutForFrame).layoutChildren
      : container.children;
  return findChildAtPosition(hitChildren, worldX - absPos.x, worldY - absPos.y);
}
