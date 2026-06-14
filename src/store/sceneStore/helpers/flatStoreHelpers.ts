import type { SceneNode, FlatSceneNode, ConnectorNode } from "../../../types/scene";
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

/**
 * Remove any connector nodes whose start/end endpoint references a node that was
 * just removed. Shared by every delete path (native delete, batch_design delete,
 * ungroup container removal) so connectors never dangle into deleted nodes and
 * leak into the saved `.pen`. Mutates the flat maps in place; returns the ids of
 * the connectors that were removed so callers can also prune them from rootIds.
 */
export function removeOrphanedConnectors(
  removedIds: Set<string>,
  nodesById: Record<string, FlatSceneNode>,
  parentById: Record<string, string | null>,
  childrenById: Record<string, string[]>,
): string[] {
  const orphanedConnectorIds: string[] = [];
  for (const id of Object.keys(nodesById)) {
    const node = nodesById[id];
    if (node?.type !== "connector") continue;
    const conn = node as ConnectorNode;
    if (
      removedIds.has(conn.startConnection.nodeId) ||
      removedIds.has(conn.endConnection.nodeId)
    ) {
      orphanedConnectorIds.push(id);
    }
  }

  for (const connId of orphanedConnectorIds) {
    const connParentId = parentById[connId];
    if (connParentId !== null && connParentId !== undefined) {
      childrenById[connParentId] = (childrenById[connParentId] ?? []).filter(
        (cid) => cid !== connId,
      );
    }
    removeNodeAndDescendants(connId, nodesById, parentById, childrenById);
  }

  return orphanedConnectorIds;
}

/**
 * Re-point connector endpoints from one node id to another. Used when a node is
 * replaced in place (batch_design R()): the node conceptually persists under a
 * new id, so its connectors should follow it rather than be orphaned. Mutates
 * connector entries in place (cloning each touched node since flat nodes are
 * shared immutable refs).
 */
export function repointConnectors(
  fromId: string,
  toId: string,
  nodesById: Record<string, FlatSceneNode>,
): void {
  for (const id of Object.keys(nodesById)) {
    const node = nodesById[id];
    if (node?.type !== "connector") continue;
    const conn = node as ConnectorNode;
    const startHit = conn.startConnection.nodeId === fromId;
    const endHit = conn.endConnection.nodeId === fromId;
    if (!startHit && !endHit) continue;
    nodesById[id] = {
      ...conn,
      startConnection: startHit
        ? { ...conn.startConnection, nodeId: toId }
        : conn.startConnection,
      endConnection: endHit
        ? { ...conn.endConnection, nodeId: toId }
        : conn.endConnection,
    };
  }
}
