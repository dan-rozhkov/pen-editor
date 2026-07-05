import { describe, it, expect, beforeEach } from "vitest";
import { usePenToolStore } from "../penToolStore";

describe("penToolStore", () => {
  beforeEach(() => {
    usePenToolStore.getState().resetDraft();
  });

  it("starts a draft with no anchors", () => {
    usePenToolStore.getState().startDraft();
    const state = usePenToolStore.getState();
    expect(state.isDrafting).toBe(true);
    expect(state.anchors).toEqual([]);
  });

  it("places a corner anchor (no drag) on commit", () => {
    usePenToolStore.getState().startDraft();
    usePenToolStore.getState().beginPlacingAnchor({ x: 10, y: 20 });
    usePenToolStore.getState().commitPendingAnchor();

    const state = usePenToolStore.getState();
    expect(state.anchors).toEqual([{ x: 10, y: 20 }]);
    expect(state.pendingAnchor).toBeNull();
  });

  it("places a smooth anchor with mirrored handles when dragged before commit", () => {
    usePenToolStore.getState().startDraft();
    usePenToolStore.getState().beginPlacingAnchor({ x: 10, y: 20 });
    usePenToolStore.getState().updatePlacingAnchorHandle({ x: 15, y: 20 });
    usePenToolStore.getState().commitPendingAnchor();

    const state = usePenToolStore.getState();
    expect(state.anchors).toEqual([
      { x: 10, y: 20, handleOut: { x: 15, y: 20 }, handleIn: { x: 5, y: 20 } },
    ]);
  });

  it("accumulates anchors across multiple placements", () => {
    const pen = usePenToolStore.getState();
    pen.startDraft();
    pen.beginPlacingAnchor({ x: 0, y: 0 });
    pen.commitPendingAnchor();
    pen.beginPlacingAnchor({ x: 10, y: 0 });
    pen.commitPendingAnchor();

    expect(usePenToolStore.getState().anchors).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it("marks the draft closed", () => {
    usePenToolStore.getState().startDraft();
    usePenToolStore.getState().closeDraft();
    expect(usePenToolStore.getState().closed).toBe(true);
  });

  it("resetDraft clears everything back to idle", () => {
    const pen = usePenToolStore.getState();
    pen.startDraft();
    pen.beginPlacingAnchor({ x: 0, y: 0 });
    pen.commitPendingAnchor();
    pen.closeDraft();

    pen.resetDraft();

    const state = usePenToolStore.getState();
    expect(state.isDrafting).toBe(false);
    expect(state.anchors).toEqual([]);
    expect(state.closed).toBe(false);
    expect(state.pendingAnchor).toBeNull();
  });

  it("tracks hover highlight state for the edit-mode overlay/cursor", () => {
    usePenToolStore.getState().setHoveredAnchor(2);
    expect(usePenToolStore.getState().hoveredAnchorIndex).toBe(2);

    usePenToolStore.getState().setHoveredHandle({ anchorIndex: 1, which: "out" });
    expect(usePenToolStore.getState().hoveredHandle).toEqual({ anchorIndex: 1, which: "out" });
  });
});
