import { describe, it, expect, beforeEach } from "vitest";
import { markNodesDirty, consumeDirty, noteSceneSetState } from "../dirtyTracking";
import { useSceneStore } from "../index";

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

  it("a no-op guard in a real mutator does not leak the armed flag", () => {
    // updateNode("nonexistent-id", ...) arms nothing useful: the mutator's
    // own guard returns `state` unchanged, so zustand's Object.is check
    // suppresses the subscriber notification and noteSceneSetState() never
    // runs for this call. If markNodesDirty had been called before `set(...)`
    // (the original bug), `armed` would stay stuck `true` and the next real,
    // untracked setState below would be wrongly treated as marked.
    useSceneStore.getState().updateNode("nonexistent-id", { x: 1 } as never);

    // A real mutation via plain setState, deliberately without marking.
    useSceneStore.setState({ pageBackground: "#000000" });

    expect(consumeDirty().complete).toBe(false);
  });
});
