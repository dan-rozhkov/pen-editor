import { describe, it, expect, beforeEach } from "vitest";
import { markNodesDirty, consumeDirty, noteSceneSetState } from "../dirtyTracking";

describe("dirtyTracking", () => {
  beforeEach(() => { consumeDirty(); });

  it("accumulates marked ids and reports complete", () => {
    markNodesDirty(["a"]); noteSceneSetState();
    markNodesDirty(["b", "c"]); noteSceneSetState();
    const d = consumeDirty();
    expect([...d.ids].sort()).toEqual(["a", "b", "c"]);
    expect(d.complete).toBe(true);
  });

  it("an untracked setState poisons the batch", () => {
    markNodesDirty(["a"]); noteSceneSetState();
    noteSceneSetState(); // untracked mutation
    expect(consumeDirty().complete).toBe(false);
  });

  it("consume drains state", () => {
    markNodesDirty(["a"]); noteSceneSetState();
    consumeDirty();
    const d = consumeDirty();
    expect(d.ids.size).toBe(0);
    expect(d.complete).toBe(true);
  });
});
