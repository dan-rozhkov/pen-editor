import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { resetStores } from "@/test/fixtures";
import { useDrawModeStore } from "@/store/drawModeStore";
import { ALL_TOOLS } from "@/lib/toolDefinitions";
import { PrimitivesPanel } from "../PrimitivesPanel";

/**
 * The bottom tool dock. Embed took Frame's old second-position slot (right
 * after Move) and Frame moved into that slot's chevron dropdown, mirroring
 * the existing Move/Rectangle/Pen `ToolDropdownGroup` pattern — see
 * toolDefinitions.ts's EMBED_TOOL/EMBED_SUB_TOOLS.
 */
describe("<PrimitivesPanel /> tool dock", () => {
  beforeEach(() => {
    resetStores();
    useDrawModeStore.setState({
      activeTool: null,
      isDrawing: false,
      drawStart: null,
      drawCurrent: null,
      pencilPoints: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders exactly one Embed button (no duplicate in the trailing group)", () => {
    render(<PrimitivesPanel />);
    expect(screen.getAllByRole("button", { name: "Embed" })).toHaveLength(1);
  });

  it("does not render a standalone Frame button — it lives in the Embed group's dropdown", () => {
    render(<PrimitivesPanel />);
    expect(screen.queryByRole("button", { name: "Frame" })).toBeNull();
  });

  it("clicking the Embed main button activates the embed tool", () => {
    render(<PrimitivesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Embed" }));
    expect(useDrawModeStore.getState().activeTool).toBe("embed");
  });

  it("opens the Embed group's dropdown and activates Frame from it", async () => {
    render(<PrimitivesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "More container tools" }));

    const frameItem = await screen.findByRole("menuitem", { name: /Frame/ });
    fireEvent.click(frameItem);

    expect(useDrawModeStore.getState().activeTool).toBe("frame");
  });

  it("ALL_TOOLS still contains frame and embed exactly once with unchanged shortcuts", () => {
    const frameEntries = ALL_TOOLS.filter((t) => t.tool === "frame");
    const embedEntries = ALL_TOOLS.filter((t) => t.tool === "embed");

    expect(frameEntries).toHaveLength(1);
    expect(embedEntries).toHaveLength(1);
    expect(frameEntries[0]).toMatchObject({ label: "Frame", shortcut: "F" });
    expect(embedEntries[0]).toMatchObject({ label: "Embed", shortcut: "E" });
  });
});
