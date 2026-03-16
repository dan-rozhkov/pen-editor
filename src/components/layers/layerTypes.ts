import type { SceneNode, FlatSceneNode, RefNode } from "../../types/scene";
import { isContainerNode } from "../../types/scene";
import { resolveRefToTree } from "../../utils/instanceRuntime";

export type DropPosition = "before" | "after" | "inside" | null;

export interface DragState {
  draggedId: string | null;
  dropTargetId: string | null;
  dropPosition: DropPosition;
  dropParentId: string | null;
  /** Set when drop target is inside a ref (instance) */
  dropInstanceId?: string | null;
  /** Path within the instance's resolved tree */
  dropDescendantPath?: string | null;
}

export interface FlattenedLayer {
  node: SceneNode;
  depth: number;
  parentId: string | null;
  /** Set on ref descendant layers — the ref node ID */
  instanceId?: string;
  /** Set on ref descendant layers — path within resolved tree */
  descendantPath?: string;
}

export const ROW_HEIGHT = 28;
export const OVERSCAN = 8;

export function getDisplayName(node: { name?: string; type: string }): string {
  return node.name || node.type.charAt(0).toUpperCase() + node.type.slice(1);
}

/** Shared ref so LayerItem can signal that selection originated from layers panel */
export const selectionFromLayersRef = { current: false };

/** Unique key for a flattened layer (used for expand tracking and React keys) */
export function getLayerKey(layer: FlattenedLayer): string {
  if (layer.instanceId && layer.descendantPath) {
    return `${layer.instanceId}:${layer.descendantPath}`;
  }
  return layer.node.id;
}

function flattenRefChildren(
  children: SceneNode[],
  instanceId: string,
  expandedFrameIds: Set<string>,
  depth: number,
  parentPath: string,
  out: FlattenedLayer[],
  nodesById?: Record<string, FlatSceneNode>,
  childrenById?: Record<string, string[]>,
): void {
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    const path = parentPath ? `${parentPath}/${child.id}` : child.id;
    const expandKey = `${instanceId}:${path}`;

    out.push({
      node: child,
      depth,
      parentId: null,
      instanceId,
      descendantPath: path,
    });

    if (child.type === "ref" && nodesById && childrenById && expandedFrameIds.has(expandKey)) {
      const nestedResolved = resolveRefToTree(child as RefNode, nodesById, childrenById);
      if (nestedResolved && nestedResolved.children.length > 0) {
        flattenRefChildren(nestedResolved.children, instanceId, expandedFrameIds, depth + 1, path, out, nodesById, childrenById);
      }
    } else if (isContainerNode(child) && child.children.length > 0 && expandedFrameIds.has(expandKey)) {
      flattenRefChildren(child.children, instanceId, expandedFrameIds, depth + 1, path, out, nodesById, childrenById);
    }
  }
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
    } else if (node.type === "ref" && nodesById && childrenById && expandedFrameIds.has(node.id)) {
      const resolved = resolveRefToTree(node as RefNode, nodesById, childrenById);
      if (resolved && resolved.children.length > 0) {
        flattenRefChildren(resolved.children, node.id, expandedFrameIds, depth + 1, "", out, nodesById, childrenById);
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
