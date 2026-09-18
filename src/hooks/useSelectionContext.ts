import { useMemo } from "react";
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
export function useSelectionContext(): SelectionContextItem[] {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  // Subscribed, not read via getState(): the name is the only thing a chip
  // shows, so a rename (Layers panel, or an agent tool call) has to reach it
  // without waiting for the selection to change. Same for a node that only
  // lands in nodesById after it was selected.
  const nodesById = useSceneStore((s) => s.nodesById);
  // selectionStore replaces the array on unrelated edits too, so key the
  // memo on the joined id set rather than the array's identity.
  const selectionKey = selectedIds.join(",");

  return useMemo(() => {
    if (selectedIds.length === 0) {
      return NO_ITEMS;
    }
    const items: SelectionContextItem[] = [];
    for (const id of selectedIds) {
      const node = nodesById[id];
      if (!node) continue;
      items.push({ nodeId: id, name: node.name ?? id, type: node.type });
    }
    return items.length > 0 ? items : NO_ITEMS;
    // selectionKey stands in for selectedIds, read fresh above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, nodesById]);
}
