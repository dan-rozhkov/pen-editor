import { describe, it, expect } from "vitest";
import { computeSceneDiffFull, computeSceneDiffDirty } from "../syncDiff";
import { generatePerfScene } from "@/dev/perfScene";
import type { SceneState } from "@/store/sceneStore";

const asState = (s: ReturnType<typeof generatePerfScene>): SceneState => s as unknown as SceneState;

describe("dirty diff equivalence", () => {
  it("matches the full scan for update/add/remove/reparent", () => {
    const prev = generatePerfScene(5, 20);
    // update one node
    const next = {
      ...prev,
      nodesById: { ...prev.nodesById, "perf-0-0": { ...prev.nodesById["perf-0-0"], x: 999 } },
    };
    const full = computeSceneDiffFull(asState(next), asState(prev));
    const dirty = computeSceneDiffDirty(asState(next), asState(prev), new Set(["perf-0-0"]));
    expect(dirty).toEqual(full);
  });

  it("matches for removal incl. children entry", () => {
    const prev = generatePerfScene(2, 3);
    const removedId = "perf-1-2";
    const nodesById = { ...prev.nodesById };
    delete nodesById[removedId];
    const childrenById = { ...prev.childrenById, "perf-frame-1": prev.childrenById["perf-frame-1"].filter((i) => i !== removedId) };
    delete childrenById[removedId];
    const next = { ...prev, nodesById, childrenById };
    const full = computeSceneDiffFull(asState(next), asState(prev));
    const dirty = computeSceneDiffDirty(asState(next), asState(prev), new Set([removedId, "perf-frame-1"]));
    expect(dirty).toEqual(full);
  });

  // Regression: moveNode (basicMutations.ts) rewrites parentById/childrenById/
  // rootIds when a node moves TO ROOT, but never touches the moved node's own
  // nodesById entry — so before the root-membership fix in syncDiff.ts, the
  // moved node was silently absent from `changedIds` on both diff paths (and
  // markNodesDirty([nodeId, oldParentId, newParentId]) drops a null
  // newParentId, so the dirty-set path never even sees it as a candidate).
  it("includes a node moved to root in changedIds (move-to-root)", () => {
    const prev = generatePerfScene(2, 3);
    const movedId = "perf-0-1";
    const oldParentId = "perf-frame-0";

    const parentById = { ...prev.parentById, [movedId]: null };
    const childrenById = {
      ...prev.childrenById,
      [oldParentId]: prev.childrenById[oldParentId].filter((id) => id !== movedId),
    };
    const rootIds = [...prev.rootIds, movedId];
    const next = { ...prev, parentById, childrenById, rootIds };

    const full = computeSceneDiffFull(asState(next), asState(prev));
    expect(full.changedIds.has(movedId)).toBe(true);

    // Mirrors moveNode's actual markNodesDirty call: [nodeId, oldParentId,
    // newParentId].filter(id => id != null) — newParentId is null here (move
    // to root), so only the node itself and its old parent are marked dirty.
    const dirty = computeSceneDiffDirty(asState(next), asState(prev), new Set([movedId, oldParentId]));
    expect(dirty.changedIds.has(movedId)).toBe(true);
    expect(dirty).toEqual(full);
  });
});
