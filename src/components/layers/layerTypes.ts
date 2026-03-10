import type { SceneNode } from "../../types/scene";
import { isContainerNode } from "../../types/scene";

export type DropPosition = "before" | "after" | "inside" | null;

export interface DragState {
  draggedId: string | null;
  dropTargetId: string | null;
  dropPosition: DropPosition;
  dropParentId: string | null;
}

export interface FlattenedLayer {
  node: SceneNode;
  depth: number;
  parentId: string | null;
}

export const ROW_HEIGHT = 28;
export const OVERSCAN = 8;

export function getDisplayName(node: { name?: string; type: string }): string {
  return node.name || node.type.charAt(0).toUpperCase() + node.type.slice(1);
}

/** Shared ref so LayerItem can signal that selection originated from layers panel */
export const selectionFromLayersRef = { current: false };

export function flattenLayers(
  nodes: SceneNode[],
  expandedFrameIds: Set<string>,
  depth = 0,
  parentId: string | null = null,
  out: FlattenedLayer[] = [],
): FlattenedLayer[] {
  for (const node of nodes) {
    out.push({ node, depth, parentId });

    if (isContainerNode(node) && expandedFrameIds.has(node.id)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        flattenLayers([node.children[i]], expandedFrameIds, depth + 1, node.id, out);
      }
    }
  }
  return out;
}
