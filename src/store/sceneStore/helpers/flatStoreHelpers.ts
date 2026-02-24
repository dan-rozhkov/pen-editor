import type { SceneNode, FlatSceneNode } from "../../../types/scene";
import {
  isContainerNode,
  toFlatNode,
  collectDescendantIds,
} from "../../../types/scene";

function normalizeRefNonFixedSize(
  node: FlatSceneNode,
  nodesById: Record<string, FlatSceneNode>,
): FlatSceneNode {
  if (node.type !== "ref") return node;

  const widthMode = node.sizing?.widthMode;
  const heightMode = node.sizing?.heightMode;
  if (
    (widthMode === undefined || widthMode === "fixed") &&
    (heightMode === undefined || heightMode === "fixed")
  ) {
    return node;
  }

  const component = nodesById[node.componentId];
  if (!component || component.type !== "frame") return node;

  const widthNeedsFallback =
    widthMode !== undefined &&
    widthMode !== "fixed" &&
    (!Number.isFinite(node.width) || node.width <= 0);
  const heightNeedsFallback =
    heightMode !== undefined &&
    heightMode !== "fixed" &&
    (!Number.isFinite(node.height) || node.height <= 0);

  if (!widthNeedsFallback && !heightNeedsFallback) return node;

  return {
    ...node,
    width: widthNeedsFallback ? component.width : node.width,
    height: heightNeedsFallback ? component.height : node.height,
  };
}

/** Insert a node and all its descendants into the flat store */
export function insertTreeIntoFlat(
  node: SceneNode,
  parentId: string | null,
  nodesById: Record<string, FlatSceneNode>,
  parentById: Record<string, string | null>,
  childrenById: Record<string, string[]>,
): void {
  nodesById[node.id] = normalizeRefNonFixedSize(toFlatNode(node), nodesById);
  parentById[node.id] = parentId;
  if (isContainerNode(node)) {
    childrenById[node.id] = node.children.map((c) => c.id);
    for (const child of node.children) {
      insertTreeIntoFlat(child, node.id, nodesById, parentById, childrenById);
    }
  }
}

/** Remove a node and all its descendants from the flat store */
export function removeNodeAndDescendants(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  parentById: Record<string, string | null>,
  childrenById: Record<string, string[]>,
): void {
  const toDelete = collectDescendantIds(nodeId, childrenById);
  toDelete.push(nodeId);
  for (const id of toDelete) {
    delete nodesById[id];
    delete parentById[id];
    delete childrenById[id];
  }
}

export function normalizeInsertedNode(
  node: FlatSceneNode,
  nodesById: Record<string, FlatSceneNode>,
): FlatSceneNode {
  return normalizeRefNonFixedSize(node, nodesById);
}
