import type { FrameNode, GroupNode, SceneNode } from "@/types/scene";
import { generateId } from "@/types/scene";

/** Deep clone a node tree preserving original IDs (for slot content) */
export function deepCloneNode(node: SceneNode): SceneNode {
  if (node.type === "frame") {
    return {
      ...node,
      children: node.children.map((child) => deepCloneNode(child)),
    } as FrameNode;
  }
  if (node.type === "group") {
    return {
      ...node,
      children: (node as GroupNode).children.map((child) => deepCloneNode(child)),
    } as GroupNode;
  }
  return { ...node } as SceneNode;
}

export function cloneNodeWithNewId(
  node: SceneNode,
  applyOffset = true,
): SceneNode {
  const newId = generateId();
  const offset = applyOffset ? 20 : 0;

  if (node.type === "frame") {
    if ((node as FrameNode).reusable) {
      return {
        id: newId,
        type: "ref",
        componentId: node.id,
        x: node.x + offset,
        y: node.y + offset,
        width: node.width,
        height: node.height,
        fill: node.fill,
        stroke: node.stroke,
        strokeWidth: node.strokeWidth,
        visible: node.visible,
        enabled: node.enabled,
      };
    }

    return {
      ...node,
      id: newId,
      x: node.x + offset,
      y: node.y + offset,
      children: node.children.map((child) => cloneNodeWithNewId(child, false)),
    } as FrameNode;
  }

  if (node.type === "group") {
    return {
      ...node,
      id: newId,
      x: node.x + offset,
      y: node.y + offset,
      children: (node as GroupNode).children.map((child) =>
        cloneNodeWithNewId(child, false),
      ),
    } as GroupNode;
  }

  if (node.type === "ref") {
    return {
      ...node,
      id: newId,
      x: node.x + offset,
      y: node.y + offset,
    };
  }

  return {
    ...node,
    id: newId,
    x: node.x + offset,
    y: node.y + offset,
  } as SceneNode;
}
