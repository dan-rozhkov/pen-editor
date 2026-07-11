import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSelectionStore } from "@/store/selectionStore";
import { resolveTargetFrame } from "../resolveTargetFrame";

describe("resolveTargetFrame", () => {
  beforeEach(() => {
    resetStores();
    seedScene(); // frame1 → [rect1, text1]; rect2 root (non-frame)
  });

  it("uses a selected frame directly", () => {
    useSelectionStore.setState({ selectedIds: ["frame1"] });
    expect(resolveTargetFrame()).toBe("frame1");
  });

  it("uses the parent frame of a selected child", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] });
    expect(resolveTargetFrame()).toBe("frame1");
  });

  it("falls back to the first top-level frame when nothing is selected", () => {
    useSelectionStore.setState({ selectedIds: [] });
    expect(resolveTargetFrame()).toBe("frame1");
  });

  it("returns null when there is no frame at all", () => {
    resetStores(); // empty scene
    useSelectionStore.setState({ selectedIds: [] });
    expect(resolveTargetFrame()).toBeNull();
  });
});
