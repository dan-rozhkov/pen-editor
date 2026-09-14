import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { useSelectionScreenshots } from "../useSelectionScreenshots";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores, seedScene } from "@/test/fixtures";

// captureNodeScreenshot touches the live PixiJS renderer, which is unavailable
// in unit tests — stub it to return a deterministic data URL per node id.
const mockCapture = vi.fn(
  async (id: string) => `data:image/png;base64,shot-${id}`
);
vi.mock("@/lib/captureNodeScreenshot", () => ({
  captureNodeScreenshot: (id: string) => mockCapture(id),
}));

// The shipped model reads images natively, so the vision-less cases below
// have no real fixture — these flags stand in for them. The hook is gated on
// modelSupportsVision (native vision only) — see useSelectionScreenshots.ts
// for why it deliberately does NOT use canSendImages the way ChatInput does.
const vision = vi.hoisted(() => ({ native: true, canSend: true }));
// Own listener set (rather than the real chatModels module's) so tests can
// deterministically force a re-render the instant vision flips, without
// depending on loadModels()/fetch plumbing.
const modelListeners = vi.hoisted(() => new Set<() => void>());
vi.mock("@/lib/chatModels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chatModels")>();
  return {
    ...actual,
    modelSupportsVision: () => vision.native,
    canSendImages: () => vision.canSend,
    subscribeModels: (listener: () => void) => {
      modelListeners.add(listener);
      return () => modelListeners.delete(listener);
    },
  };
});

function flipVision(native: boolean, canSend = native) {
  vision.native = native;
  vision.canSend = canSend;
  for (const listener of modelListeners) listener();
}

beforeEach(() => {
  resetStores();
  vision.native = true;
  vision.canSend = true;
  modelListeners.clear();
  mockCapture.mockClear();
});

afterEach(() => cleanup());

describe("useSelectionScreenshots", () => {
  it("returns no items when nothing is selected", () => {
    const { result } = renderHook(() => useSelectionScreenshots());
    expect(result.current).toEqual([]);
  });

  it("captures a screenshot for a selected non-frame node", async () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["rect2"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current[0]).toMatchObject({
      nodeId: "rect2",
      name: "Floating",
      type: "rect",
      dataUrl: "data:image/png;base64,shot-rect2",
    });
  });

  it("returns a reference-only item for a selected frame, without capturing a screenshot", async () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["frame1"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current[0]).toEqual({
      nodeId: "frame1",
      name: "Screen",
      type: "frame",
      dataUrl: null,
    });
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("screenshots only the non-frame node when a frame and a rect are both selected", async () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["frame1", "rect2"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    await waitFor(() => expect(result.current.length).toBe(2));
    expect(result.current.map((s) => s.nodeId)).toEqual(["frame1", "rect2"]);
    expect(result.current[0]).toEqual({
      nodeId: "frame1",
      name: "Screen",
      type: "frame",
      dataUrl: null,
    });
    expect(result.current[1]).toMatchObject({
      nodeId: "rect2",
      dataUrl: "data:image/png;base64,shot-rect2",
    });
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith("rect2");
  });

  it("skips ids that are no longer in the scene", async () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["rect2", "ghost"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current[0].nodeId).toBe("rect2");
  });

  it("returns empty for a vision-less model without capturing a non-frame node", async () => {
    seedScene();
    vision.native = false;
    vision.canSend = false;
    useSelectionStore.getState().setSelectedIds(["rect2"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    // Give the debounce a chance to (not) fire.
    await new Promise((r) => setTimeout(r, 250));
    expect(result.current).toEqual([]);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("returns a reference-only frame item even for a vision-less model", async () => {
    // A frame's id costs no image tokens either way — it must not be
    // withheld just because the model can't read images.
    seedScene();
    vision.native = false;
    vision.canSend = false;
    useSelectionStore.getState().setSelectedIds(["frame1"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current[0]).toEqual({
      nodeId: "frame1",
      name: "Screen",
      type: "frame",
      dataUrl: null,
    });
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("returns empty for a non-frame node without native vision, even though canSendImages would allow it", async () => {
    // No native vision, but the backend's auxiliary vision model could still
    // describe an attached image as text. This hook must stay gated on
    // native vision (see
    // useSelectionScreenshots.ts's doc comment): auto-attaching here would
    // silently trigger a blocking describeImage round trip per screenshot
    // the user never asked for.
    seedScene();
    vision.native = false;
    vision.canSend = true;
    useSelectionStore.getState().setSelectedIds(["rect2"]);

    const { result } = renderHook(() => useSelectionScreenshots());

    // Give the debounce a chance to (not) fire.
    await new Promise((r) => setTimeout(r, 250));
    expect(result.current).toEqual([]);
  });

  it("stops serving a screenshot captured before vision flips off, without waiting for the debounce", async () => {
    // Regression: the result used to be keyed only by the selection, not by
    // canAttach. So when supportsVision flipped from true to false mid-session
    // (metadata arriving after an initial optimistic true), a screenshot taken
    // while vision was on kept being served for up to CAPTURE_DEBOUNCE_MS —
    // until the re-capture (now correctly returning nothing) landed. The
    // result must read as empty the instant vision flips, not after a delay.
    seedScene();
    useSelectionStore.getState().setSelectedIds(["rect2"]);

    const { result, rerender } = renderHook(() => useSelectionScreenshots());

    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current[0]).toMatchObject({
      nodeId: "rect2",
      dataUrl: "data:image/png;base64,shot-rect2",
    });

    act(() => flipVision(false));
    rerender();

    // No re-capture has had time to run yet — the stale image item must not
    // be served just because it matches the still-current selection.
    expect(result.current).toEqual([]);

    // The re-capture that follows the flip settles on empty too (rect2 isn't
    // a reference-only type, and vision is off).
    await new Promise((r) => setTimeout(r, 250));
    expect(result.current).toEqual([]);
  });
});
