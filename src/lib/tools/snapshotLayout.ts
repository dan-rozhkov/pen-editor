import { useSceneStore } from "@/store/sceneStore";
import type { FlatSceneNode } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";

interface LayoutRect {
  id: string;
  name?: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children?: LayoutRect[] | "...";
}

/**
 * Compute absolute position by walking up the parent chain.
 */
function getAbsolutePosition(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  parentById: Record<string, string | null>
): { x: number; y: number } {
  let absX = 0;
  let absY = 0;
  let currentId: string | null = nodeId;

  while (currentId) {
    const node = nodesById[currentId];
    if (node) {
      absX += node.x;
      absY += node.y;
    }
    currentId = parentById[currentId] ?? null;
  }

  return { x: absX, y: absY };
}

/**
 * Check if a child is clipped (extends beyond parent bounds).
 */
function isClipped(
  childAbs: { x: number; y: number; width: number; height: number },
  parentAbs: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    childAbs.x < parentAbs.x ||
    childAbs.y < parentAbs.y ||
    childAbs.x + childAbs.width > parentAbs.x + parentAbs.width ||
    childAbs.y + childAbs.height > parentAbs.y + parentAbs.height
  );
}

function buildLayoutTree(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  parentById: Record<string, string | null>,
  maxDepth: number | undefined,
  currentDepth: number,
  problemsOnly: boolean
): LayoutRect | null {
  const node = nodesById[nodeId];
  if (!node) return null;
  if (node.visible === false) return null;

  const abs = getAbsolutePosition(nodeId, nodesById, parentById);
  const rect: LayoutRect = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: abs.x,
    y: abs.y,
    width: node.width,
    height: node.height,
  };

  const childIds = childrenById[nodeId];
  if (childIds && childIds.length > 0) {
    if (maxDepth !== undefined && currentDepth >= maxDepth) {
      rect.children = "...";
    } else {
      const parentBounds = { x: abs.x, y: abs.y, width: node.width, height: node.height };
      const childRects: LayoutRect[] = [];

      for (const cid of childIds) {
        const childNode = nodesById[cid];
        if (!childNode || childNode.visible === false) continue;

        const childResult = buildLayoutTree(
          cid, nodesById, childrenById, parentById,
          maxDepth, currentDepth + 1, problemsOnly
        );

        if (childResult) {
          if (problemsOnly) {
            const childBounds = {
              x: childResult.x,
              y: childResult.y,
              width: childResult.width,
              height: childResult.height,
            };
            // Include if child is clipped or has problem children
            if (isClipped(childBounds, parentBounds) || childResult.children) {
              childRects.push(childResult);
            }
          } else {
            childRects.push(childResult);
          }
        }
      }

      if (childRects.length > 0) {
        rect.children = childRects;
      }
    }
  }

  // In problemsOnly mode, skip nodes with no problems and no problematic children
  if (problemsOnly && !rect.children) {
    // Check if this node itself is a root — always include roots
    const parentId = parentById[nodeId];
    if (parentId) {
      const parentNode = nodesById[parentId];
      if (parentNode) {
        const parentAbs = getAbsolutePosition(parentId, nodesById, parentById);
        const parentBounds = { x: parentAbs.x, y: parentAbs.y, width: parentNode.width, height: parentNode.height };
        if (!isClipped({ x: abs.x, y: abs.y, width: node.width, height: node.height }, parentBounds)) {
          return null;
        }
      }
    }
  }

  return rect;
}

export const snapshotLayout: ToolHandler = async (args) => {
  const parentId = args.parentId as string | undefined;
  const maxDepth = args.maxDepth as number | undefined;
  const problemsOnly = (args.problemsOnly as boolean) ?? false;

  const { nodesById, childrenById, parentById, rootIds } = useSceneStore.getState();

  const startIds = parentId
    ? childrenById[parentId] ?? []
    : rootIds;

  // If parentId specified, include the parent itself
  const idsToProcess = parentId ? [parentId] : startIds;

  const results: LayoutRect[] = [];
  for (const id of idsToProcess) {
    const rect = buildLayoutTree(
      id, nodesById, childrenById, parentById,
      maxDepth, 0, problemsOnly
    );
    if (rect) results.push(rect);
  }

  return JSON.stringify(results);
};
