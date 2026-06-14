import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ExportSection } from "../ExportSection";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import type { SceneNode } from "@/types/scene";

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
