import type { FlatSceneNode, HistorySnapshot } from "../../../types/scene";
import { useHistoryStore } from "../../historyStore";
import { useSelectionStore } from "../../selectionStore";

/** Create a history snapshot (shallow clone - node refs are immutable) */
export function createSnapshot(state: {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
}): HistorySnapshot {
  const selection = useSelectionStore.getState();
  return {
    nodesById: { ...state.nodesById },
    parentById: { ...state.parentById },
    childrenById: { ...state.childrenById },
    rootIds: [...state.rootIds],
    selection: {
      selectedIds: [...selection.selectedIds],
      instanceContext: selection.instanceContext
        ? { ...selection.instanceContext }
        : null,
      selectedDescendantIds: [...selection.selectedDescendantIds],
      enteredContainerId: selection.enteredContainerId,
      lastSelectedId: selection.lastSelectedId,
    },
  };
}

/** Save current state to history */
export function saveHistory(state: {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
}): void {
  useHistoryStore.getState().saveHistory(createSnapshot(state));
}
