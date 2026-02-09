import type { FrameNode, GroupNode, SceneNode } from "@/types/scene";

/**
 * Recursively apply auto-layout to a component tree.
 * Walks the tree, prepares children, and calls calculateLayoutForFrame
 * for any frame with autoLayout enabled.
 */
export function applyAutoLayoutRecursively(
  node: SceneNode,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): SceneNode {
  if (node.type === "frame") {
    const frameNode = node as FrameNode;
    const preparedChildren = frameNode.children.map((child) =>
      applyAutoLayoutRecursively(child, calculateLayoutForFrame),
    );
    const preparedFrame: FrameNode = { ...frameNode, children: preparedChildren };

    if (!preparedFrame.layout?.autoLayout) {
      return preparedFrame;
    }

    const laidOutChildren = calculateLayoutForFrame(preparedFrame).map((child) =>
      applyAutoLayoutRecursively(child, calculateLayoutForFrame),
    );

    return { ...preparedFrame, children: laidOutChildren };
  }

  if (node.type === "group") {
    const groupNode = node as GroupNode;
    return {
      ...groupNode,
      children: groupNode.children.map((child) =>
        applyAutoLayoutRecursively(child, calculateLayoutForFrame),
      ),
    } as GroupNode;
  }

  return node;
}
