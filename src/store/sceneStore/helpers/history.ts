import type { FlatSceneNode, FlatSnapshot } from "../../../types/scene";
import { useHistoryStore } from "../../historyStore";

/** Create a history snapshot (shallow clone - node refs are immutable) */
export function createSnapshot(state: {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
}): FlatSnapshot {
  return {
    nodesById: { ...state.nodesById },
    parentById: { ...state.parentById },
    childrenById: { ...state.childrenById },
    rootIds: [...state.rootIds],
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
