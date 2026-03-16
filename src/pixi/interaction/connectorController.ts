import { useSceneStore } from "@/store/sceneStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useConnectorStore } from "@/store/connectorStore";
import type { AnchorPosition, ConnectorNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import { getAnchorWorldPosition } from "@/utils/connectorUtils";
import type { InteractionContext } from "./types";

const ANCHOR_THRESHOLD = 20;

export interface ConnectorController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerUp(e: PointerEvent, world: { x: number; y: number }): boolean;
}

function findNearestAnchor(
  worldPos: { x: number; y: number },
  excludeNodeId?: string,
): { nodeId: string; anchor: AnchorPosition; pos: { x: number; y: number } } | null {
  const state = useSceneStore.getState();
  const nodes = state.getNodes();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  let bestDist = ANCHOR_THRESHOLD;
  let best: { nodeId: string; anchor: AnchorPosition; pos: { x: number; y: number } } | null = null;

  const anchors: AnchorPosition[] = ["top", "right", "bottom", "left"];
  // Margin for cheap bounding-box rejection (threshold + anchor offset)
  const margin = ANCHOR_THRESHOLD + 15;

  for (const id of Object.keys(state.nodesById)) {
    if (id === excludeNodeId) continue;
    const node = state.nodesById[id];
    if (!node || node.type === "connector") continue;
    if (node.visible === false || node.enabled === false) continue;

    // Cheap AABB proximity check — skip nodes far from cursor
    if (
      worldPos.x < node.x - margin ||
      worldPos.x > node.x + node.width + margin ||
      worldPos.y < node.y - margin ||
      worldPos.y > node.y + node.height + margin
    ) continue;

    for (const anchor of anchors) {
      const pos = getAnchorWorldPosition(id, anchor, nodes, calculateLayoutForFrame);
      if (!pos) continue;
      const dx = worldPos.x - pos.x;
      const dy = worldPos.y - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = { nodeId: id, anchor, pos };
      }
    }
  }

  return best;
}

export function createConnectorController(
  _context: InteractionContext,
): ConnectorController {
  let isDrawing = false;

  return {
    handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean {
      const { activeTool } = useDrawModeStore.getState();
      if (activeTool !== "connector" || e.button !== 0) return false;

      const nearest = findNearestAnchor(world);

      if (nearest) {
        isDrawing = true;
        useConnectorStore.getState().startConnectorDraw(nearest.nodeId, nearest.anchor);
        useConnectorStore.getState().updatePreview(world);
        return true;
      }

      return false;
    },

    handlePointerMove(_e: PointerEvent, world: { x: number; y: number }): boolean {
      const { activeTool } = useDrawModeStore.getState();
      if (activeTool !== "connector") return false;

      const connState = useConnectorStore.getState();

      if (isDrawing && connState.sourceNodeId) {
        connState.updatePreview(world);

        const nearest = findNearestAnchor(world, connState.sourceNodeId);

        if (nearest) {
          connState.setHoveredAnchor(nearest.nodeId, nearest.anchor);
        } else {
          connState.setHoveredAnchor(null, null);
        }
        return true;
      }

      // When idle with connector tool, update hover for anchor display
      const nearest = findNearestAnchor(world);
      if (nearest) {
        connState.setHoveredAnchor(nearest.nodeId, nearest.anchor);
      } else {
        connState.setHoveredAnchor(null, null);
      }
      return false;
    },

    handlePointerUp(_e: PointerEvent, _world: { x: number; y: number }): boolean {
      if (!isDrawing) return false;
      isDrawing = false;

      const connState = useConnectorStore.getState();
      if (!connState.sourceNodeId || !connState.sourceAnchor) {
        connState.cancelConnectorDraw();
        return true;
      }

      if (!connState.hoveredNodeId || !connState.hoveredAnchor) {
        connState.cancelConnectorDraw();
        return true;
      }

      // Create the connector node
      const nodes = useSceneStore.getState().getNodes();
      const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;

      const startPos = getAnchorWorldPosition(
        connState.sourceNodeId, connState.sourceAnchor, nodes, calculateLayoutForFrame,
      );
      const endPos = getAnchorWorldPosition(
        connState.hoveredNodeId, connState.hoveredAnchor, nodes, calculateLayoutForFrame,
      );

      if (!startPos || !endPos) {
        connState.cancelConnectorDraw();
        return true;
      }

      const minX = Math.min(startPos.x, endPos.x);
      const minY = Math.min(startPos.y, endPos.y);
      const maxX = Math.max(startPos.x, endPos.x);
      const maxY = Math.max(startPos.y, endPos.y);

      const nodeWidth = Math.max(maxX - minX, 1);
      const nodeHeight = Math.max(maxY - minY, 1);

      const id = generateId();
      const connectorNode: ConnectorNode = {
        id,
        type: "connector",
        x: minX,
        y: minY,
        width: nodeWidth,
        height: nodeHeight,
        stroke: "#333333",
        strokeWidth: 2,
        startConnection: {
          nodeId: connState.sourceNodeId,
          anchor: connState.sourceAnchor,
        },
        endConnection: {
          nodeId: connState.hoveredNodeId,
          anchor: connState.hoveredAnchor,
        },
        points: [
          startPos.x - minX,
          startPos.y - minY,
          endPos.x - minX,
          endPos.y - minY,
        ],
      };

      useSceneStore.getState().addNode(connectorNode);
      useSelectionStore.getState().select(id);
      connState.endConnectorDraw();
      return true;
    },
  };
}
