import type { FlatFrameNode, FlatSceneNode } from "@/types/scene";

export function findComponentByIdFlat(
  nodesById: Record<string, FlatSceneNode>,
  id: string,
): FlatFrameNode | null {
  const node = nodesById[id];
  if (node?.type === "frame" && (node as FlatFrameNode).reusable) {
    return node as FlatFrameNode;
  }
  return null;
}

export function getAllComponentsFlat(
  nodesById: Record<string, FlatSceneNode>,
): FlatFrameNode[] {
  return Object.values(nodesById).filter(
    (node): node is FlatFrameNode => node.type === "frame" && !!(node as FlatFrameNode).reusable,
  );
}
