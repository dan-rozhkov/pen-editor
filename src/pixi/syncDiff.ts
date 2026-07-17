import type { SceneState } from "@/store/sceneStore";

/**
 * `moveNode` (basicMutations.ts) rewrites `parentById`/`childrenById`/
 * `rootIds` when a node moves, but the moved node's own object reference in
 * `nodesById` is untouched — so a move TO root (unlike a move INTO a frame,
 * which is covered by the new parent's `childrenById` entry changing) leaves
 * the moved node out of `changedIds` on both diff paths, and downstream
 * consumers (culling index, hit-testing) never reindex it at its new
 * position. Root MEMBERSHIP changes (an id present in one `rootIds` array
 * but not the other) are therefore added to `changedIds` directly here, at
 * the diff level, so both `computeSceneDiffFull` and `computeSceneDiffDirty`
 * are fixed in one place. O(roots).
 */
function addRootMembershipChanges(
  state: SceneState,
  prev: SceneState,
  changedIds: Set<string>,
): void {
  if (state.rootIds === prev.rootIds) return;
  const prevRootSet = new Set(prev.rootIds);
  const curRootSet = new Set(state.rootIds);
  for (const id of curRootSet) {
    if (!prevRootSet.has(id)) changedIds.add(id);
  }
  for (const id of prevRootSet) {
    if (!curRootSet.has(id)) changedIds.add(id);
  }
}

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
  addRootMembershipChanges(state, prev, changedIds);
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
  addRootMembershipChanges(state, prev, changedIds);
  return { changedIds, addedIds, removedIds, updatedIds };
}
