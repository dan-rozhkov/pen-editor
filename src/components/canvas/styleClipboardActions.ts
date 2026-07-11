import type { HistorySnapshot, SceneNode } from "@/types/scene";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useStyleClipboardStore } from "@/store/styleClipboardStore";
import { extractNodeStyle, pickStyleUpdatesForNode } from "@/utils/styleClipboard";

/**
 * Dependencies the "copy/paste properties" actions need from the host hook —
 * a subset of {@link ClipboardActionDeps} (node copy/paste), reused for the
 * style clipboard so both mutate history through the same batching pattern.
 */
export interface StyleClipboardActionDeps {
  updateNode: (id: string, updates: Partial<SceneNode>) => void;
  saveHistory: (snapshot: HistorySnapshot) => void;
  startBatch: () => void;
  endBatch: () => void;
}

/**
 * Copy/paste *properties* (fills, strokes, effects, corner radius, opacity,
 * typography) — Figma-style "Copy/Paste properties", bound to
 * Cmd+Opt+C / Cmd+Opt+V. Distinct from node copy/paste ({@link
 * createClipboardActions}): this never touches geometry or duplicates nodes,
 * only mutates the style fields of whatever is already selected.
 */
export function createStyleClipboardActions(deps: StyleClipboardActionDeps) {
  const { updateNode, saveHistory, startBatch, endBatch } = deps;

  const copyStyleSelection = (): void => {
    const { selectedIds } = useSelectionStore.getState();
    const sourceId = selectedIds[0];
    if (!sourceId) return;
    const node = useSceneStore.getState().nodesById[sourceId];
    if (!node) return;
    useStyleClipboardStore.getState().copyStyle(extractNodeStyle(node));
  };

  const pasteStyleSelection = (): void => {
    const { copiedStyle } = useStyleClipboardStore.getState();
    if (!copiedStyle) return;

    const { selectedIds } = useSelectionStore.getState();
    if (selectedIds.length === 0) return;

    const nodesById = useSceneStore.getState().nodesById;
    const pendingUpdates: Array<[string, Partial<SceneNode>]> = [];
    for (const id of selectedIds) {
      const node = nodesById[id];
      if (!node) continue;
      const updates = pickStyleUpdatesForNode(node, copiedStyle);
      if (Object.keys(updates).length > 0) {
        pendingUpdates.push([id, updates]);
      }
    }
    if (pendingUpdates.length === 0) return;

    // One undo step for the whole paste, regardless of selection size —
    // mirrors the delete/paste-node pattern: explicit saveHistory before
    // batchMode is flipped on, so per-node updateNode calls don't each push
    // their own history entry.
    saveHistory(createSnapshot(useSceneStore.getState()));
    startBatch();
    try {
      for (const [id, updates] of pendingUpdates) {
        updateNode(id, updates);
      }
    } finally {
      endBatch();
    }
  };

  return { copyStyleSelection, pasteStyleSelection };
}
