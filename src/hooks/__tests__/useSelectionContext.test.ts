import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useSelectionContext } from "../useSelectionContext";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";

// Screenshots must never be taken for selection context anymore, regardless
// of node type — assert the capture helper is never even called.
const mockCapture = vi.fn(async (id: string) => `data:image/png;base64,shot-${id}`);
vi.mock("@/lib/captureNodeScreenshot", () => ({
  captureNodeScreenshot: (id: string) => mockCapture(id),
}));

beforeEach(() => {
  resetStores();
  mockCapture.mockClear();
});

afterEach(() => cleanup());

describe("useSelectionContext", () => {
  it("returns a stable empty array when nothing is selected", () => {
    const { result, rerender } = renderHook(() => useSelectionContext());
    const first = result.current;
    expect(first).toEqual([]);
    rerender();
    // Same reference across renders while the selection stays empty.
    expect(result.current).toBe(first);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("returns a reference item (no screenshot) for a selected frame", () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["frame1"]);

    const { result } = renderHook(() => useSelectionContext());

    expect(result.current).toEqual([
      { nodeId: "frame1", name: "Screen", type: "frame" },
    ]);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("returns a reference item (no screenshot) for a selected text node", () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["text1"]);

    const { result } = renderHook(() => useSelectionContext());

    expect(result.current).toEqual([{ nodeId: "text1", name: "Title", type: "text" }]);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("returns a reference item (no screenshot) for a selected rect", () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["rect2"]);

    const { result } = renderHook(() => useSelectionContext());

    expect(result.current).toEqual([
      { nodeId: "rect2", name: "Floating", type: "rect" },
    ]);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("returns one item per selected node, in selection order", () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["frame1", "rect2"]);

    const { result } = renderHook(() => useSelectionContext());

    expect(result.current.map((s) => s.nodeId)).toEqual(["frame1", "rect2"]);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("skips ids that are no longer in the scene", () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["rect2", "ghost"]);

    const { result } = renderHook(() => useSelectionContext());

    expect(result.current).toEqual([
      { nodeId: "rect2", name: "Floating", type: "rect" },
    ]);
  });

  it("picks up a rename of an already-selected node", async () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds(["frame1"]);

    const { result } = renderHook(() => useSelectionContext());
    expect(result.current[0].name).toBe("Screen");

    await act(async () => {
      useSceneStore.getState().updateNode("frame1", { name: "Renamed" });
    });

    // The chip shows nothing but the name, so a rename has to reach it
    // without waiting for the selection to change.
    expect(result.current[0].name).toBe("Renamed");
  });
});
