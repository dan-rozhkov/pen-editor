import type { FrameNode, GroupNode, SceneNode } from "@/types/scene";

/**
 * Recursively apply auto-layout to a component tree.
 * Materializes layout-computed x/y/width/height into descendants while
 * preserving the original child order and non-flow children.
 */
export function applyAutoLayoutRecursively(
  node: SceneNode,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): SceneNode {
  return applyNodeLayout(node, calculateLayoutForFrame);
}

function applyNodeLayout(
  node: SceneNode,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
  layoutOverride?: Pick<SceneNode, "x" | "y" | "width" | "height">,
): SceneNode {
  const currentNode = layoutOverride
    ? ({ ...node, ...layoutOverride } as SceneNode)
    : node;

  if (currentNode.type === "frame") {
    const frameNode = currentNode as FrameNode;
    if (!frameNode.layout?.autoLayout) {
      return {
        ...frameNode,
        children: frameNode.children.map((child) =>
          applyNodeLayout(child, calculateLayoutForFrame),
        ),
      };
    }

    const laidOutChildren = calculateLayoutForFrame(frameNode);
    const layoutById = new Map(
      laidOutChildren.map((child) => [
        child.id,
        {
          x: child.x,
          y: child.y,
          width: child.width,
          height: child.height,
        },
      ]),
    );

    return {
      ...frameNode,
      children: frameNode.children.map((child) =>
        applyNodeLayout(
          child,
          calculateLayoutForFrame,
          layoutById.get(child.id),
        ),
      ),
    };
  }

  if (currentNode.type === "group") {
    const groupNode = currentNode as GroupNode;
    return {
      ...groupNode,
      children: groupNode.children.map((child) =>
        applyNodeLayout(child, calculateLayoutForFrame),
      ),
    } as GroupNode;
  }

  return currentNode;
}
