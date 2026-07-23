import { describe, it, expect, beforeEach } from "vitest";
import { getScreenshot } from "@/lib/tools/getScreenshot";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores, seedScene } from "@/test/fixtures";

beforeEach(() => {
  resetStores();
  seedScene();
});

describe("get_screenshot", () => {
  it("errors when no nodeId is given and nothing is selected", async () => {
    const result = JSON.parse(await getScreenshot({}));
    expect(result.error).toMatch(/nodeId is required/);
  });

  it("errors when no nodeId is given and multiple nodes are selected", async () => {
    useSelectionStore.getState().setSelectedIds(["frame1", "rect1"]);
    const result = JSON.parse(await getScreenshot({}));
    expect(result.error).toMatch(/multiple nodes are selected/);
  });

  it("falls back to the single selected node when nodeId is omitted", async () => {
    useSelectionStore.getState().setSelectedIds(["frame1"]);
    const result = JSON.parse(await getScreenshot({}));
    // No PixiJS renderer is initialized in this unit test environment (per
    // repo convention, get_screenshot's WebGL path is e2e-only) — falling
    // through to the existing "no canvas renderer" branch proves the
    // selected node id (not a validation error) was resolved and used.
    expect(result.error).toBe("No canvas renderer available");
  });

  it("still errors when an explicit nodeId does not exist", async () => {
    const result = JSON.parse(await getScreenshot({ nodeId: "ghost" }));
    expect(result.error).toBe("Node not found: ghost");
  });
});
