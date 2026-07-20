import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import type { FlatSceneNode, ConnectorNode } from "@/types/scene";
import { isConnectorNode } from "@/types/scene";
import { getAnchorWorldPosition } from "@/utils/connectorUtils";
import { computeConnectorBounds } from "./interaction/connectorGeometry";

/**
 * Maintains the connector index (targetNodeId → connectorIds referencing it)
 * and recomputes connector geometry when their connected nodes move/resize.
 */
export function createConnectorManager() {
  // Connector index: targetNodeId → set of connectorIds that reference it
  const connectorIndex = new Map<string, Set<string>>();

  function addToConnectorIndex(connectorId: string, node: ConnectorNode): void {
    for (const targetId of [node.startConnection.nodeId, node.endConnection.nodeId]) {
      let set = connectorIndex.get(targetId);
      if (!set) {
        set = new Set();
        connectorIndex.set(targetId, set);
      }
      set.add(connectorId);
    }
  }

  function removeFromConnectorIndex(connectorId: string, node: ConnectorNode): void {
    for (const targetId of [node.startConnection.nodeId, node.endConnection.nodeId]) {
      const set = connectorIndex.get(targetId);
      if (set) {
        set.delete(connectorId);
        if (set.size === 0) connectorIndex.delete(targetId);
      }
    }
  }

  function buildConnectorIndex(nodesById: Record<string, FlatSceneNode>): void {
    connectorIndex.clear();
    for (const id of Object.keys(nodesById)) {
      const node = nodesById[id];
      if (node && isConnectorNode(node)) {
        addToConnectorIndex(id, node);
      }
    }
  }

  function updateConnectorsForNodes(changedIds: Set<string> | string[]): void {
    // Collect every connector attached to any of the changed (non-connector)
    // nodes into a single set, so each connector is recomputed at most once.
    const connectorIds = new Set<string>();
    for (const nodeId of changedIds) {
      const attached = connectorIndex.get(nodeId);
      if (!attached) continue;
      for (const connId of attached) connectorIds.add(connId);
    }
    if (connectorIds.size === 0) return;

    // Single tree fetch + layout accessor for the whole flush.
    const currentState = useSceneStore.getState();
    const nodes = currentState.getNodes();
    const calcLayout = useLayoutStore.getState().calculateLayoutForFrame;

    const updatesById: Record<string, Partial<ConnectorNode>> = {};
    for (const connId of connectorIds) {
      const connNode = currentState.nodesById[connId];
      if (!connNode || !isConnectorNode(connNode)) continue;

      const conn = connNode;
      const startPos = getAnchorWorldPosition(conn.startConnection.nodeId, conn.startConnection.anchor, nodes, calcLayout);
      const endPos = getAnchorWorldPosition(conn.endConnection.nodeId, conn.endConnection.anchor, nodes, calcLayout);
      if (!startPos || !endPos) continue;

      const { minX, minY, nodeWidth, nodeHeight } = computeConnectorBounds(startPos, endPos);
      const points = [
        startPos.x - minX,
        startPos.y - minY,
        endPos.x - minX,
        endPos.y - minY,
      ];

      // Skip no-op updates: geometry unchanged ⇒ no store write (which would
      // otherwise create a fresh node object and schedule another sync pass).
      const prev = conn.points;
      if (
        conn.x === minX &&
        conn.y === minY &&
        conn.width === nodeWidth &&
        conn.height === nodeHeight &&
        prev.length === 4 &&
        prev[0] === points[0] &&
        prev[1] === points[1] &&
        prev[2] === points[2] &&
        prev[3] === points[3]
      ) {
        continue;
      }

      updatesById[connId] = {
        x: minX,
        y: minY,
        width: nodeWidth,
        height: nodeHeight,
        points,
      };
    }

    if (Object.keys(updatesById).length > 0) {
      useSceneStore.getState().updateNodesWithoutHistory(updatesById);
    }
  }

  function clear(): void {
    connectorIndex.clear();
  }

  return {
    addToConnectorIndex,
    removeFromConnectorIndex,
    buildConnectorIndex,
    updateConnectorsForNodes,
    clear,
  };
}
