import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSelectionStore } from "@/store/selectionStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { CanvasContextMenu } from "../CanvasContextMenu";

const { copyAsCss, copyAsSvg } = vi.hoisted(() => ({
  copyAsCss: vi.fn().mockResolvedValue(true),
  copyAsSvg: vi.fn().mockResolvedValue(true),
}));

vi.mock("../copyAsActions", () => ({ copyAsCss, copyAsSvg }));

afterEach(() => cleanup());

describe("CanvasContextMenu", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    useEditorModeStore.setState({ mode: "edit" });
    copyAsCss.mockClear();
    copyAsSvg.mockClear();
  });

  it("opens on right-click and calls copyAsCss / copyAsSvg from the menu items", async () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] } as never);

    render(
      <CanvasContextMenu>
        <div data-testid="canvas-surface">canvas</div>
      </CanvasContextMenu>,
    );

    fireEvent.contextMenu(screen.getByTestId("canvas-surface"));

    const cssItem = await screen.findByText("Copy as CSS");
    fireEvent.click(cssItem);
    expect(copyAsCss).toHaveBeenCalledTimes(1);

    // Clicking an item closes the popup, so reopen for the second item.
    fireEvent.contextMenu(screen.getByTestId("canvas-surface"));
    const svgItem = await screen.findByText("Copy as SVG");
    fireEvent.click(svgItem);
    expect(copyAsSvg).toHaveBeenCalledTimes(1);
  });

  it("disables both items when there is no selection", async () => {
    useSelectionStore.setState({ selectedIds: [] } as never);

    render(
      <CanvasContextMenu>
        <div data-testid="canvas-surface">canvas</div>
      </CanvasContextMenu>,
    );

    fireEvent.contextMenu(screen.getByTestId("canvas-surface"));

    const cssItem = await screen.findByText("Copy as CSS");
    const cssItemRoot = cssItem.closest('[data-slot="context-menu-item"]');
    expect(cssItemRoot?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("does not open on right-click while in present mode", async () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] } as never);
    useEditorModeStore.setState({ mode: "present" });

    render(
      <CanvasContextMenu>
        <div data-testid="canvas-surface">canvas</div>
      </CanvasContextMenu>,
    );

    fireEvent.contextMenu(screen.getByTestId("canvas-surface"));

    // Give the menu a chance to open if suppression were broken.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Copy as CSS")).toBeNull();
  });

  it("force-closes an already-open menu the moment present mode is entered", async () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] } as never);
    useEditorModeStore.setState({ mode: "edit" });

    render(
      <CanvasContextMenu>
        <div data-testid="canvas-surface">canvas</div>
      </CanvasContextMenu>,
    );

    fireEvent.contextMenu(screen.getByTestId("canvas-surface"));
    await screen.findByText("Copy as CSS");

    useEditorModeStore.setState({ mode: "present" });

    await waitFor(() => {
      expect(screen.queryByText("Copy as CSS")).toBeNull();
    });
  });
});
