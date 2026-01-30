import type { FrameNode, GroupNode, SceneNode } from "@/types/scene";
import { generateId } from "@/types/scene";

export function cloneNodeWithNewId(node: SceneNode): SceneNode {
  const newId = generateId();

  if (node.type === "frame") {
    if ((node as FrameNode).reusable) {
      return {
        id: newId,
        type: "ref",
        componentId: node.id,
        x: node.x + 20,
        y: node.y + 20,
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
      x: node.x + 20,
      y: node.y + 20,
      children: node.children.map((child) => cloneNodeWithNewId(child)),
    } as FrameNode;
  }

  if (node.type === "group") {
    return {
      ...node,
      id: newId,
      x: node.x + 20,
      y: node.y + 20,
      children: (node as GroupNode).children.map((child) =>
        cloneNodeWithNewId(child),
      ),
    } as GroupNode;
  }

  if (node.type === "ref") {
    return {
      ...node,
      id: newId,
      x: node.x + 20,
      y: node.y + 20,
    };
  }

  return {
    ...node,
    id: newId,
    x: node.x + 20,
    y: node.y + 20,
  } as SceneNode;
}
