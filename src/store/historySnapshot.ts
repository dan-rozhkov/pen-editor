import type {
  ComponentArtifact,
  FlatSceneNode,
  HistorySnapshot,
  SelectionSnapshot,
} from "@/types/scene";

export interface SnapshotSceneSlice {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
  componentArtifactsById?: Record<string, ComponentArtifact>;
}

/**
 * The ONE place that knows the shape of a history snapshot. Pure — reads no
 * stores. Both sceneStore mutations (helpers/history.ts) and selection-change
 * history (selectionStore.ts) delegate here; adding a snapshot field means
 * editing exactly this function.
 *
 * componentArtifactsById is always carried (empty object when the slice has
 * none): restoreSnapshot replaces the artifact map with
 * `snapshot.componentArtifactsById ?? {}`, so omitting it would wipe component
 * sync-state on undo.
 */
export function buildHistorySnapshot(
  scene: SnapshotSceneSlice,
  variables: HistorySnapshot["variables"],
  selection: SelectionSnapshot,
): HistorySnapshot {
  return {
    nodesById: { ...scene.nodesById },
    parentById: { ...scene.parentById },
    childrenById: { ...scene.childrenById },
    rootIds: [...scene.rootIds],
    componentArtifactsById: { ...(scene.componentArtifactsById ?? {}) },
    variables: [...(variables ?? [])],
    selection: {
      selectedIds: [...selection.selectedIds],
      enteredContainerId: selection.enteredContainerId,
      lastSelectedId: selection.lastSelectedId,
    },
  };
}
