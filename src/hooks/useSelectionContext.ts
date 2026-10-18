import { useMemo } from "react";
import { usePanelSelection } from "@/lib/canvasLink/usePanelSelection";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import type { SceneNode } from "@/types/scene";

export interface SelectionContextItem {
  nodeId: string;
  name: string;
  type: SceneNode["type"];
}

// Stable identity so consumers that memo on the returned array don't re-run
// every render while nothing is selected.
const NO_ITEMS: SelectionContextItem[] = [];
const NO_IDS: string[] = [];
const NO_NODES: Record<string, never> = {};

const KNOWN_TYPES: Record<SceneNode["type"], true> = {
  frame: true, group: true, rect: true, ellipse: true, text: true, path: true,
  line: true, polygon: true, embed: true, connector: true,
};

/** A wire `type` string as a node type; an unknown one (newer tab) shows as a frame. */
function toNodeType(type: string): SceneNode["type"] {
  return isNodeType(type) ? type : "frame";
}

function isNodeType(type: string): type is SceneNode["type"] {
  return Object.hasOwn(KNOWN_TYPES, type);
}

/** Pure: the chip items for a selection (shared with the canvas link host, which publishes them). */
export function computeSelectionItems(
  selectedIds: readonly string[],
  nodesById: Record<string, Pick<SceneNode, "name" | "type">>,
): SelectionContextItem[] {
  const items: SelectionContextItem[] = [];
  for (const id of selectedIds) {
    const node = nodesById[id];
    if (!node) continue;
    items.push({ nodeId: id, name: node.name ?? id, type: node.type });
  }
  return items;
}

/**
 * Context about the currently selected canvas nodes, kept in sync with the
 * selection and shown above the chat input. This is deliberately a bare
 * id/name/type triple — no screenshot is ever captured here for any node
 * type. The node's id already rides along in canvasContext's
 * `selectedIds`/`selectedNodes` (see `buildCanvasContext` in
 * useDesignChat.ts), so the agent can call `get_screenshot` itself with that
 * id the moment a turn actually needs pixels, instead of paying for a
 * screenshot on every selection change whether or not anything downstream
 * ever looks at it.
 *
 * Returns a stable empty array when nothing is selected.
 */
export function useSelectionContext(sessionId?: string): SelectionContextItem[] {
  // In the desktop agent panel the local stores are empty: the chips come from the bound canvas tab.
  const remote = usePanelSelection(sessionId);
  // In the panel the local stores stay unread: constant selectors never re-render.
  const selectedIds = useSelectionStore((s) => (remote ? NO_IDS : s.selectedIds));
  // Subscribed, not read via getState(): the name is the only thing a chip
  // shows, so a rename (Layers panel, or an agent tool call) has to reach it
  // without waiting for the selection to change. Same for a node that only
  // lands in nodesById after it was selected.
  const nodesById = useSceneStore((s) => (remote ? NO_NODES : s.nodesById));
  // selectionStore replaces the array on unrelated edits too, so key the
  // memo on the joined id set rather than the array's identity.
  const selectionKey = selectedIds.join(",");

  const local = useMemo(() => {
    if (selectedIds.length === 0) {
      return NO_ITEMS;
    }
    const items = computeSelectionItems(selectedIds, nodesById);
    return items.length > 0 ? items : NO_ITEMS;
    // selectionKey stands in for selectedIds, read fresh above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, nodesById]);

  const remoteItems = useMemo(
    () =>
      remote && remote.nodes.length > 0
        ? remote.nodes.map((n) => ({ nodeId: n.nodeId, name: n.name, type: toNodeType(n.type) }))
        : NO_ITEMS,
    [remote],
  );
  return remote ? remoteItems : local;
}