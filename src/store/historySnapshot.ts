import type {
  ComponentArtifact,
  FlatSceneNode,
  HistorySnapshot,
  SelectionSnapshot,
} from "@/types/scene";
import type { Guide } from "./guidesStore";

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
 * sync-state on undo. guides is likewise always carried (current page's
 * persistent ruler guides) so guide create/move/delete round-trips through
 * undo/redo. textStyles is carried the same way (named reusable text styles)
 * so text-style add/update/delete round-trips through undo/redo too.
 * fillStyles/effectStyles (shared fill/effect styles) are carried the same
 * way so their create/update/delete/apply/detach round-trips through
 * undo/redo too.
 */
export function buildHistorySnapshot(
  scene: SnapshotSceneSlice,
  variables: HistorySnapshot["variables"],
  selection: SelectionSnapshot,
  guides: Guide[],
  textStyles: HistorySnapshot["textStyles"],
  fillStyles: HistorySnapshot["fillStyles"],
  effectStyles: HistorySnapshot["effectStyles"],
): HistorySnapshot {
  return {
    nodesById: { ...scene.nodesById },
    parentById: { ...scene.parentById },
    childrenById: { ...scene.childrenById },
    rootIds: [...scene.rootIds],
    componentArtifactsById: { ...(scene.componentArtifactsById ?? {}) },
    variables: [...(variables ?? [])],
    guides: [...(guides ?? [])],
    textStyles: [...(textStyles ?? [])],
    fillStyles: [...(fillStyles ?? [])],
    effectStyles: [...(effectStyles ?? [])],
    selection: {
      selectedIds: [...selection.selectedIds],
      enteredContainerId: selection.enteredContainerId,
      lastSelectedId: selection.lastSelectedId,
    },
  };
}
