import type { SceneState } from "@/store/sceneStore";

export interface SceneDiff {
  changedIds: Set<string>; // added + updated + removed + children-changed hosts
  addedIds: string[];
  removedIds: string[];
  updatedIds: string[]; // exists in both, reference changed
}

/** Full-scan diff — exact behavior of the historical incrementalUpdate scans. */
export function computeSceneDiffFull(state: SceneState, prev: SceneState): SceneDiff {
  const changedIds = new Set<string>();
  const addedIds: string[] = [];
  const removedIds: string[] = [];
  const updatedIds: string[] = [];
  for (const id of Object.keys(state.nodesById)) {
    const node = state.nodesById[id];
    const prevNode = prev.nodesById[id];
    if (!prevNode) {
      addedIds.push(id);
      changedIds.add(id);
    } else if (node !== prevNode) {
      updatedIds.push(id);
      changedIds.add(id);
    }
  }
  for (const id of Object.keys(prev.nodesById)) {
    if (!state.nodesById[id]) {
      removedIds.push(id);
      changedIds.add(id);
    }
  }
  for (const id of Object.keys(state.childrenById)) {
    if (state.childrenById[id] !== prev.childrenById[id]) changedIds.add(id);
  }
  for (const id of Object.keys(prev.childrenById)) {
    if (!state.childrenById[id]) changedIds.add(id);
  }
  return { changedIds, addedIds, removedIds, updatedIds };
}

/** Dirty-set diff — same output, iterating only candidate ids. */
export function computeSceneDiffDirty(
  state: SceneState,
  prev: SceneState,
  dirtyIds: Set<string>,
): SceneDiff {
  const changedIds = new Set<string>();
  const addedIds: string[] = [];
  const removedIds: string[] = [];
  const updatedIds: string[] = [];
  for (const id of dirtyIds) {
    const node = state.nodesById[id];
    const prevNode = prev.nodesById[id];
    if (node && !prevNode) {
      addedIds.push(id);
      changedIds.add(id);
    } else if (!node && prevNode) {
      removedIds.push(id);
      changedIds.add(id);
    } else if (node && prevNode && node !== prevNode) {
      updatedIds.push(id);
      changedIds.add(id);
    }
    if (state.childrenById[id] !== prev.childrenById[id]) changedIds.add(id);
  }
  return { changedIds, addedIds, removedIds, updatedIds };
}
