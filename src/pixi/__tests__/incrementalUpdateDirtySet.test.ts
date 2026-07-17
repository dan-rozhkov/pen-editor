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
});
