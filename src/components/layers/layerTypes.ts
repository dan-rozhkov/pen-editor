import type { SceneNode, FlatSceneNode } from "../../types/scene";
import { isContainerNode } from "../../types/scene";
import { getNodeDisplayName } from "@/utils/nodeDisplay";

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

export const getDisplayName = getNodeDisplayName;

/** Shared ref so LayerItem can signal that selection originated from layers panel */
export const selectionFromLayersRef = { current: false };

/** Unique key for a flattened layer (used for expand tracking and React keys) */
export function getLayerKey(layer: FlattenedLayer): string {
  return layer.node.id;
}

function flattenLayersRec(
  nodes: SceneNode[],
  expandedFrameIds: Set<string>,
  nodesById: Record<string, FlatSceneNode> | undefined,
  childrenById: Record<string, string[]> | undefined,
  depth: number,
  parentId: string | null,
  out: FlattenedLayer[],
): void {
  for (const node of nodes) {
    out.push({ node, depth, parentId });

    if (isContainerNode(node) && expandedFrameIds.has(node.id)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        flattenLayersRec([node.children[i]], expandedFrameIds, nodesById, childrenById, depth + 1, node.id, out);
      }
    }
  }
}

export function flattenLayers(
  nodes: SceneNode[],
  expandedFrameIds: Set<string>,
  nodesById?: Record<string, FlatSceneNode>,
  childrenById?: Record<string, string[]>,
): FlattenedLayer[] {
  const out: FlattenedLayer[] = [];
  flattenLayersRec(nodes, expandedFrameIds, nodesById, childrenById, 0, null, out);
  return out;
}
