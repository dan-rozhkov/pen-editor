import type { ComponentArtifact, FlatSceneNode, HistorySnapshot } from "../../../types/scene";
import { buildHistorySnapshot } from "../../historySnapshot";
import { useGuidesStore } from "../../guidesStore";
import { useHistoryStore } from "../../historyStore";
import { useSelectionStore } from "../../selectionStore";
import { useVariableStore } from "../../variableStore";
import { useStyleStore } from "../../styleStore";
import { useTextStyleStore } from "../../textStyleStore";
import { useMeasurementsStore } from "../../measurementsStore";

/** Create a history snapshot (shallow clone - node refs are immutable) */
export function createSnapshot(state: {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
  componentArtifactsById?: Record<string, ComponentArtifact>;
  slideOrder?: string[];
}): HistorySnapshot {
  const selection = useSelectionStore.getState();
  return buildHistorySnapshot(
    state,
    useVariableStore.getState().variables,
    {
      selectedIds: selection.selectedIds,
      enteredContainerId: selection.enteredContainerId,
      lastSelectedId: selection.lastSelectedId,
    },
    useGuidesStore.getState().guides,
    useTextStyleStore.getState().textStyles,
    useStyleStore.getState().fillStyles,
    useStyleStore.getState().effectStyles,
    state.slideOrder ?? [],
    useMeasurementsStore.getState().measurements,
  );
}

/** Save current state to history */
export function saveHistory(state: {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
  componentArtifactsById?: Record<string, ComponentArtifact>;
  slideOrder?: string[];
}): void {
  useHistoryStore.getState().saveHistory(createSnapshot(state));
}
