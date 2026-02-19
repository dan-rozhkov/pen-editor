import type { SceneNode } from "@/types/scene";

/**
 * Walk a resolved instance tree along a slash-separated ID path
 * (e.g. "frameA/textB"), skipping invisible/disabled nodes at each level.
 * Returns the node found at the end of the path, or null.
 */
export function findDescendantByPath(
  children: SceneNode[],
  path: string,
): SceneNode | null {
  let currentChildren = children.filter(
    (child) => child.visible !== false && child.enabled !== false,
  );
  let current: SceneNode | null = null;
  const segments = path.split("/").filter((s) => s.length > 0);
  for (const segment of segments) {
    const found = currentChildren.find((child) => child.id === segment);
    if (!found) return null;
    current = found;
    if (current.type === "frame" || current.type === "group") {
      currentChildren = current.children.filter(
        (child) => child.visible !== false && child.enabled !== false,
      );
    } else {
      currentChildren = [];
    }
  }
  return current;
}

/**
 * Walk a path and accumulate the local position offset.
 */
export function findDescendantPositionByPath(
  children: SceneNode[],
  path: string,
): { x: number; y: number } | null {
  let currentChildren = children.filter(
    (child) => child.visible !== false && child.enabled !== false,
  );
  let offsetX = 0;
  let offsetY = 0;
  const segments = path.split("/").filter((s) => s.length > 0);
  for (const segment of segments) {
    const node = currentChildren.find((child) => child.id === segment);
    if (!node) return null;
    offsetX += node.x;
    offsetY += node.y;
    if (node.type === "frame" || node.type === "group") {
      currentChildren = node.children.filter(
        (child) => child.visible !== false && child.enabled !== false,
      );
    } else {
      currentChildren = [];
    }
  }
  return { x: offsetX, y: offsetY };
}

/**
 * Walk a path and return the accumulated local rect (position + size of leaf).
 */
export function findDescendantRectByPath(
  children: SceneNode[],
  path: string,
): { x: number; y: number; width: number; height: number } | null {
  let currentChildren = children.filter(
    (child) => child.visible !== false && child.enabled !== false,
  );
  let offsetX = 0;
  let offsetY = 0;
  let current: SceneNode | null = null;
  const segments = path.split("/").filter((s) => s.length > 0);
  for (const segment of segments) {
    const found = currentChildren.find((child) => child.id === segment);
    if (!found) return null;
    current = found;
    offsetX += current.x;
    offsetY += current.y;
    if (current.type === "frame" || current.type === "group") {
      currentChildren = current.children.filter(
        (child) => child.visible !== false && child.enabled !== false,
      );
    } else {
      currentChildren = [];
    }
  }
  if (!current) return null;
  return { x: offsetX, y: offsetY, width: current.width, height: current.height };
}
