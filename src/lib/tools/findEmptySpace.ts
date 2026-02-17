import { useSceneStore } from "@/store/sceneStore";
import type { ToolHandler } from "../toolRegistry";

export const findEmptySpace: ToolHandler = async (args) => {
  const width = args.width as number;
  const height = args.height as number;
  const padding = (args.padding as number) ?? 50;
  const direction = (args.direction as string) ?? "right";
  const nodeId = args.nodeId as string | undefined;

  if (!width || !height) {
    return JSON.stringify({ error: "width and height are required" });
  }

  const { nodesById, parentById, rootIds } = useSceneStore.getState();

  let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

  if (nodeId) {
    // Use the specified node's bounds
    const node = nodesById[nodeId];
    if (!node) {
      return JSON.stringify({ error: `Node "${nodeId}" not found` });
    }
    const abs = getAbsolutePosition(nodeId, nodesById, parentById);
    bounds = {
      minX: abs.x,
      minY: abs.y,
      maxX: abs.x + node.width,
      maxY: abs.y + node.height,
    };
  } else {
    // Compute bounding box of all root-level nodes
    for (const rid of rootIds) {
      const node = nodesById[rid];
      if (!node || node.visible === false) continue;
      const x = node.x;
      const y = node.y;
      if (!bounds) {
        bounds = { minX: x, minY: y, maxX: x + node.width, maxY: y + node.height };
      } else {
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x + node.width);
        bounds.maxY = Math.max(bounds.maxY, y + node.height);
      }
    }
  }

  // If canvas is empty, place at origin
  if (!bounds) {
    return JSON.stringify({ x: 0, y: 0 });
  }

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  let x: number;
  let y: number;

  switch (direction) {
    case "right":
      x = bounds.maxX + padding;
      y = centerY - height / 2;
      break;
    case "left":
      x = bounds.minX - padding - width;
      y = centerY - height / 2;
      break;
    case "bottom":
      x = centerX - width / 2;
      y = bounds.maxY + padding;
      break;
    case "top":
      x = centerX - width / 2;
      y = bounds.minY - padding - height;
      break;
    default:
      x = bounds.maxX + padding;
      y = centerY - height / 2;
  }

  return JSON.stringify({ x: Math.round(x), y: Math.round(y) });
};

function getAbsolutePosition(
  nodeId: string,
  nodesById: Record<string, { x: number; y: number }>,
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
