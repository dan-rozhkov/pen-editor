import type { FrameNode, SceneNode } from "@/types/scene";
import { isContainerNode } from "@/types/scene";

/**
 * Find a component (reusable FrameNode) by ID.
 */
export function findComponentById(
  nodes: SceneNode[],
  id: string,
): FrameNode | null {
  for (const node of nodes) {
    if (node.type === "frame" && node.id === id && node.reusable) {
      return node;
    }
    if (isContainerNode(node)) {
      const found = findComponentById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Get all reusable components from the scene tree.
 */
export function getAllComponents(nodes: SceneNode[]): FrameNode[] {
  const components: FrameNode[] = [];

  function collect(searchNodes: SceneNode[]) {
    for (const node of searchNodes) {
      if (node.type === "frame") {
        if (node.reusable) {
          components.push(node);
        }
        collect(node.children);
      } else if (node.type === "group") {
        collect(node.children);
      }
    }
  }

  collect(nodes);
  return components;
}
