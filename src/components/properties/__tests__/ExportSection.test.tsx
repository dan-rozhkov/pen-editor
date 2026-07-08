import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ExportSection } from "../ExportSection";
import { getFrameDescriptor, getTopLevelFrames } from "@/utils/exportPdfUtils";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import type { SceneNode, FlatSceneNode } from "@/types/scene";
import { resetStores } from "@/test/fixtures";

function makeNode(extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id: "n1",
    type: "rect",
    name: "My Box",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...extra,
  } as SceneNode;
}

beforeEach(() => {
  // resetStores() does not touch canvasRefStore; ensure a clean (null) baseline.
  useCanvasRefStore.setState({ pixiRefs: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ExportSection />", () => {
  it("renders the Export section with scale and format selectors", () => {
    render(<ExportSection selectedNode={makeNode()} />);
    expect(screen.getByText("Export")).toBeTruthy();
    // Default scale "1×" and format "PNG" labels render in the triggers.
    expect(screen.getByText("1×")).toBeTruthy();
    expect(screen.getByText("PNG")).toBeTruthy();
  });

  it("labels the export button with the selected node name", () => {
    render(<ExportSection selectedNode={makeNode({ name: "Hero" })} />);
    expect(screen.getByText("Export Hero")).toBeTruthy();
  });

  it("falls back to 'Untitled' when no node is selected", () => {
    render(<ExportSection selectedNode={null} />);
    expect(screen.getByText("Export Untitled")).toBeTruthy();
  });

  it("logs an error and skips export when pixi refs are unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ExportSection selectedNode={makeNode()} />);

    fireEvent.click(screen.getByText("Export My Box"));
    // handleExport is async; flush the microtask queue.
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith("Pixi refs are not available");
  });

  it("renders both format options' default selection (PNG, not JPEG)", () => {
    // base-ui Select dropdowns are flaky in happy-dom, so we assert the default
    // selected labels render in the triggers rather than driving the dropdown.
    render(<ExportSection selectedNode={makeNode()} />);
    expect(screen.getByText("PNG")).toBeTruthy();
    expect(screen.queryByText("JPEG")).toBeNull();
  });
});

describe("getFrameDescriptor / getTopLevelFrames (PDF page sizing & order)", () => {
  /** Column auto-layout frame, height=fit_content, stored height stale/wrong. */
  function seedHugContentFrame(id: string, stored: { width: number; height: number }): void {
    const frame = {
      id,
      type: "frame",
      name: id,
      x: 0,
      y: 0,
      width: stored.width,
      height: stored.height,
      layout: {
        autoLayout: true,
        flexDirection: "column",
        gap: 0,
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
      },
      sizing: { widthMode: "fixed", heightMode: "fit_content" },
    } as unknown as FlatSceneNode;

    const child = {
      id: `${id}-child`,
      type: "rect",
      x: 0,
      y: 0,
      width: stored.width,
      height: 40,
      sizing: { widthMode: "fixed", heightMode: "fixed" },
    } as unknown as FlatSceneNode;

    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, [id]: frame, [`${id}-child`]: child },
      parentById: { ...s.parentById, [id]: null, [`${id}-child`]: id },
      childrenById: { ...s.childrenById, [id]: [`${id}-child`] },
      rootIds: [...s.rootIds, id],
      _cachedTree: null,
    }));
  }

  beforeEach(() => {
    resetStores();
  });

  it("resolves the effective (hug-content) size instead of the raw stored width/height", () => {
    // Stored height (200) is stale; the frame actually hugs its one 40px-tall child.
    seedHugContentFrame("f1", { width: 100, height: 200 });

    const descriptor = getFrameDescriptor("f1", "f1");

    expect(descriptor.width).toBe(100);
    expect(descriptor.height).toBe(40);
  });

  it("orders top-level frames to match the Layers panel (reverse of rootIds)", () => {
    seedHugContentFrame("first", { width: 50, height: 50 });
    seedHugContentFrame("second", { width: 50, height: 50 });

    expect(useSceneStore.getState().rootIds).toEqual(["first", "second"]);

    const frames = getTopLevelFrames();

    expect(frames.map((f) => f.id)).toEqual(["second", "first"]);
  });
});
