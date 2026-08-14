import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { useSelectionScreenshots } from "../useSelectionScreenshots";
import { useChatStore } from "@/store/chatStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores, seedScene } from "@/test/fixtures";

// captureNodeScreenshot touches the live PixiJS renderer, which is unavailable
// in unit tests — stub it to return a deterministic data URL per node id.
vi.mock("@/lib/captureNodeScreenshot", () => ({
  captureNodeScreenshot: vi.fn(
    async (id: string) => `data:image/png;base64,shot-${id}`
  ),
}));

// Drive vision support off the model name so a non-vision case is testable
// (the real fallback model list is all vision-capable). Keep the rest of the
// module intact — chatStore depends on getDefaultModel(). The hook is gated
// on modelSupportsVision (native vision only) — see useSelectionScreenshots.ts
// for why it deliberately does NOT use canSendImages the way ChatInput does.
vi.mock("@/lib/chatModels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chatModels")>();
  return {
    ...actual,
    // "non-vision/*" — no native vision, no backend fallback either.
    // "fallback-only/*" — no native vision, but the backend's auxiliary
    // vision model can still describe an attached image as text.
    // Anything else — native vision.
    modelSupportsVision: (model: string) =>
      !model.includes("non-vision") && !model.includes("fallback-only"),
    canSendImages: (model: string) => !model.includes("non-vision"),
  };
});

beforeEach(() => {
  resetStores();
  useChatStore.setState({ model: "google/gemini-2.5-flash" });
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

  it("returns empty for non-vision models without capturing", async () => {
    seedScene();
    useChatStore.setState({ model: "non-vision/text-only" });
    useSelectionStore.getState().setSelectedIds(["frame1"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    // Give the debounce a chance to (not) fire.
    await new Promise((r) => setTimeout(r, 250));
    expect(result.current).toEqual([]);
  });

  it("returns empty for a fallback-only model, even though canSendImages would allow it", async () => {
    // "fallback-only/model" fails the mocked modelSupportsVision but passes
    // the mocked canSendImages — standing in for a model without native
    // vision that only reads images via the backend's auxiliary vision
    // fallback. This hook must stay gated on native vision (see
    // useSelectionScreenshots.ts's doc comment): auto-attaching here would
    // silently trigger a blocking describeImage round trip per screenshot
    // the user never asked for.
    seedScene();
    useChatStore.setState({ model: "fallback-only/model" });
    useSelectionStore.getState().setSelectedIds(["frame1"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    // Give the debounce a chance to (not) fire.
    await new Promise((r) => setTimeout(r, 250));
    expect(result.current).toEqual([]);
  });
});
