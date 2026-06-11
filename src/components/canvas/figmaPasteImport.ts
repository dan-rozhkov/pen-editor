import type { HistorySnapshot, SceneNode } from "@/types/scene";
import { createSnapshot, useSceneStore } from "@/store/sceneStore";
import { setImportedSelection } from "./imageImport";

interface ApplyFigmaPasteNodesParams {
  nodes: SceneNode[];
  viewportCenter: { x: number; y: number };
  addNode: (node: SceneNode) => void;
  saveHistory: (snapshot: HistorySnapshot) => void;
  startBatch: () => void;
  endBatch: () => void;
}

/**
 * Insert nodes converted from a Figma paste: center the group on the viewport
 * (preserving relative offsets), add as roots in one undo batch, select them.
 * Mirrors applyImageImportPlans for the image-paste path.
 */
export function applyFigmaPasteNodes({
  nodes,
  viewportCenter,
  addNode,
  saveHistory,
  startBatch,
  endBatch,
}: ApplyFigmaPasteNodesParams): void {
  if (nodes.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  const offsetX = viewportCenter.x - (minX + maxX) / 2;
  const offsetY = viewportCenter.y - (minY + maxY) / 2;

  saveHistory(createSnapshot(useSceneStore.getState()));
  startBatch();
  try {
    for (const node of nodes) {
      node.x += offsetX;
      node.y += offsetY;
      addNode(node);
    }
  } finally {
    endBatch();
  }

  setImportedSelection(nodes.map((node) => node.id));
}
