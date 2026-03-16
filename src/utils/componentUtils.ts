import type { FlatFrameNode, FlatSceneNode, InstanceOverrides, RefNode } from "@/types/scene";
import { generateId } from "@/types/scene";

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

/**
 * Find the slot context for a descendant path inside an instance.
 * Walks path segments backwards to find a replace override.
 * Returns the slot path and the relative path from the slot to the target.
 */
export function findSlotContext(
  descendantPath: string,
  overrides?: InstanceOverrides,
): { slotPath: string; relativePath: string } | null {
  if (!overrides) return null;
  const segments = descendantPath.split("/");
  for (let i = segments.length - 1; i >= 0; i--) {
    const candidatePath = segments.slice(0, i).join("/");
    if (candidatePath && overrides[candidatePath]?.kind === "replace") {
      return { slotPath: candidatePath, relativePath: segments.slice(i).join("/") };
    }
  }
  return null;
}

/**
 * Create a RefNode pointing to a reusable component.
 */
export function createRefFromComponent(
  componentId: string,
  width: number,
  height: number,
): RefNode {
  return {
    id: generateId(),
    type: "ref",
    componentId,
    x: 0,
    y: 0,
    width,
    height,
  };
}

export function isInsideReusableComponent(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  parentById: Record<string, string | null>,
): boolean {
  let currentId = parentById[nodeId] ?? null;
  while (currentId != null) {
    const node = nodesById[currentId];
    if (node?.type === "frame" && (node as FlatFrameNode).reusable) {
      return true;
    }
    currentId = parentById[currentId] ?? null;
  }
  return false;
}
