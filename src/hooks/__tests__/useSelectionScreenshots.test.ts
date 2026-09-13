import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { useSelectionScreenshots } from "../useSelectionScreenshots";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores, seedScene } from "@/test/fixtures";

// captureNodeScreenshot touches the live PixiJS renderer, which is unavailable
// in unit tests — stub it to return a deterministic data URL per node id.
vi.mock("@/lib/captureNodeScreenshot", () => ({
  captureNodeScreenshot: vi.fn(
    async (id: string) => `data:image/png;base64,shot-${id}`
  ),
}));

// The shipped model reads images natively, so the vision-less cases below
// have no real fixture — these flags stand in for them. The hook is gated on
// modelSupportsVision (native vision only) — see useSelectionScreenshots.ts
// for why it deliberately does NOT use canSendImages the way ChatInput does.
const vision = vi.hoisted(() => ({ native: true, canSend: true }));
vi.mock("@/lib/chatModels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chatModels")>();
  return {
    ...actual,
    modelSupportsVision: () => vision.native,
    canSendImages: () => vision.canSend,
  };
});

beforeEach(() => {
  resetStores();
  vision.native = true;
  vision.canSend = true;
});

afterEach(() => cleanup());

describe("useSelectionScreenshots", () => {
  it("returns no screenshots when nothing is selected", () => {
    const { result } = renderHook(() => useSelectionScreenshots());
    expect(result.current).toEqual([]);
  });

  it("captures a screenshot for each selected node", async () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["frame1", "rect2"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    await waitFor(() => expect(result.current.length).toBe(2));
    expect(result.current.map((s) => s.nodeId)).toEqual(["frame1", "rect2"]);
    expect(result.current[0]).toMatchObject({
      nodeId: "frame1",
      name: "Screen",
      dataUrl: "data:image/png;base64,shot-frame1",
    });
  });

  it("skips ids that are no longer in the scene", async () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["frame1", "ghost"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current[0].nodeId).toBe("frame1");
  });

  it("returns empty for a vision-less model without capturing", async () => {
    seedScene();
    vision.native = false;
    vision.canSend = false;
    useSelectionStore.getState().setSelectedIds(["frame1"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    // Give the debounce a chance to (not) fire.
    await new Promise((r) => setTimeout(r, 250));
    expect(result.current).toEqual([]);
  });

  it("returns empty without native vision, even though canSendImages would allow it", async () => {
    // No native vision, but the backend's auxiliary vision model could still
    // describe an attached image as text. This hook must stay gated on
    // native vision (see
    // useSelectionScreenshots.ts's doc comment): auto-attaching here would
    // silently trigger a blocking describeImage round trip per screenshot
    // the user never asked for.
    seedScene();
    vision.native = false;
    vision.canSend = true;
    useSelectionStore.getState().setSelectedIds(["frame1"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    // Give the debounce a chance to (not) fire.
    await new Promise((r) => setTimeout(r, 250));
    expect(result.current).toEqual([]);
  });
});
