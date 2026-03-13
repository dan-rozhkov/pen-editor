import type { FlatSceneNode, FrameNode, GroupNode, RefNode, SceneNode } from "@/types/scene";
import { resolveRefToTree } from "@/utils/instanceRuntime";

function getNodeChildren(
  node: SceneNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): SceneNode[] {
  if (node.type === "frame" || node.type === "group") {
    if (Array.isArray(node.children)) {
      return node.children;
    }

    const childIds = childrenById[node.id] ?? [];
    return childIds
      .map((childId) => nodesById[childId] as SceneNode | undefined)
      .filter((child): child is SceneNode => Boolean(child));
  }
  return [];
}

function materializeNode(
  node: SceneNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): SceneNode {
  if (node.type === "ref") {
    const resolved = resolveRefToTree(node as RefNode, nodesById, childrenById);
    if (!resolved) return node;

    return {
      ...resolved,
      id: node.id,
      children: getNodeChildren(resolved, nodesById, childrenById).map((child) =>
        materializeNode(child, nodesById, childrenById),
      ),
    } as FrameNode;
  }

  if (node.type === "frame") {
    return {
      ...(node as FrameNode),
      children: getNodeChildren(node, nodesById, childrenById).map((child) =>
        materializeNode(child, nodesById, childrenById),
      ),
    } as FrameNode;
  }

  if (node.type === "group") {
    return {
      ...(node as GroupNode),
      children: getNodeChildren(node, nodesById, childrenById).map((child) =>
        materializeNode(child, nodesById, childrenById),
      ),
    } as GroupNode;
  }

  return node;
}

export function materializeLayoutRefs(
  frame: FrameNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): FrameNode {
  return materializeNode(frame, nodesById, childrenById) as FrameNode;
}
