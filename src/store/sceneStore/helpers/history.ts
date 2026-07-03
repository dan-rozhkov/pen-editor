import type { ComponentArtifact, FlatSceneNode, HistorySnapshot } from "../../../types/scene";
import { buildHistorySnapshot } from "../../historySnapshot";
import { useHistoryStore } from "../../historyStore";
import { useSelectionStore } from "../../selectionStore";
import { useVariableStore } from "../../variableStore";

/** Create a history snapshot (shallow clone - node refs are immutable) */
export function createSnapshot(state: {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
  componentArtifactsById?: Record<string, ComponentArtifact>;
}): HistorySnapshot {
  const selection = useSelectionStore.getState();
  return buildHistorySnapshot(state, useVariableStore.getState().variables, {
    selectedIds: selection.selectedIds,
    enteredContainerId: selection.enteredContainerId,
    lastSelectedId: selection.lastSelectedId,
  });
}

/** Save current state to history */
export function saveHistory(state: {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
  componentArtifactsById?: Record<string, ComponentArtifact>;
}): void {
  useHistoryStore.getState().saveHistory(createSnapshot(state));
}
