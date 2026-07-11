import { describe, it, expect, beforeEach } from "vitest";
import { useHistoryStore, withHistoryBatch } from "@/store/historyStore";
import { setExportSettings } from "@/lib/tools/setExportSettings";
import { resetStores, seedScene } from "@/test/fixtures";

beforeEach(() => {
  resetStores();
  seedScene();
});

describe("withHistoryBatch", () => {
  it("returns the wrapped function's return value and closes the batch", () => {
    const result = withHistoryBatch(() => {
      expect(useHistoryStore.getState().batchDepth).toBe(1);
      return 42;
    });

    expect(result).toBe(42);
    expect(useHistoryStore.getState().batchDepth).toBe(0);
    expect(useHistoryStore.getState().batchMode).toBe(false);
  });

  it("closes the batch and re-throws when the wrapped function throws", () => {
    expect(() =>
      withHistoryBatch(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(useHistoryStore.getState().batchDepth).toBe(0);
    expect(useHistoryStore.getState().batchMode).toBe(false);
  });

  it("history recording keeps working after a throwing batch (regression for bug-09)", () => {
    const history = useHistoryStore.getState();

    expect(() =>
      withHistoryBatch(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");

    const pastBefore = useHistoryStore.getState().past.length;
    history.saveHistory({
      nodesById: {},
      parentById: {},
      childrenById: {},
      rootIds: [],
      variables: [],
      selection: { selectedIds: [], enteredContainerId: null, lastSelectedId: null },
      guides: [],
      textStyles: [],
      fillStyles: [],
      effectStyles: [],
    });

    // Before the fix: batchMode stays stuck true forever, so saveHistory is a no-op.
    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
  });
});

describe("setStyles tool call site (converted to withHistoryBatch)", () => {
  it("still records exactly one undo step per call and returns the tool result", async () => {
    const pastBefore = useHistoryStore.getState().past.length;

    const result = JSON.parse(
      await setExportSettings({ nodeIds: ["rect1"], format: "png" }),
    );

    expect(result).toEqual({ success: true, updatedCount: 1 });
    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
  });
});
