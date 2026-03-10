import type { SceneNode, FlatSceneNode } from "../../../types/scene";
import {
  isContainerNode,
  toFlatNode,
  collectDescendantIds,
} from "../../../types/scene";

/** Insert a node and all its descendants into the flat store */
export function insertTreeIntoFlat(
  node: SceneNode,
  parentId: string | null,
  nodesById: Record<string, FlatSceneNode>,
  parentById: Record<string, string | null>,
  childrenById: Record<string, string[]>,
): void {
  nodesById[node.id] = toFlatNode(node);
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
