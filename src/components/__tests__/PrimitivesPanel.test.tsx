import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { resetStores } from "@/test/fixtures";
import { useDrawModeStore } from "@/store/drawModeStore";
import { ALL_TOOLS } from "@/lib/toolDefinitions";
import { PrimitivesPanel } from "../PrimitivesPanel";

/**
 * The bottom tool dock. Embed took Frame's old second-position slot (right
 * after Move) and renders as a plain button with no chevron of its own;
 * Frame moved into the Rectangle group's "More shapes" dropdown — see
 * toolDefinitions.ts's EMBED_TOOL/RECT_SUB_TOOLS.
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

  it("does not render a standalone Frame button — it lives in the shapes dropdown", () => {
    render(<PrimitivesPanel />);
    expect(screen.queryByRole("button", { name: "Frame" })).toBeNull();
  });

  // Structural rather than label-based: a chevron re-added to the Embed slot
  // under any wording must fail this, so counting the dropdown triggers beats
  // querying the tooltip strings that happen to exist today.
  it("renders exactly three chevron triggers — Move, shapes and Pen, none for Embed", () => {
    render(<PrimitivesPanel />);
    const chevrons = screen
      .getAllByRole("button")
      .filter((b) => /^More /.test(b.getAttribute("aria-label") ?? ""));

    expect(chevrons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "More move tools",
      "More shapes",
      "More pen tools",
    ]);
  });

  it("clicking the Embed main button activates the embed tool", () => {
    render(<PrimitivesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Embed" }));
    expect(useDrawModeStore.getState().activeTool).toBe("embed");
  });

  it("opens the shapes dropdown and activates Frame from it", async () => {
    render(<PrimitivesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "More shapes" }));

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

  describe("header variant", () => {
    it("is the floating card by default and compact without a card in the header", () => {
      const floating = render(<PrimitivesPanel />);
      expect(floating.container.querySelector(".absolute.bottom-4")).not.toBeNull();
      expect(floating.container.querySelector(".rounded-2xl")).not.toBeNull();
      floating.unmount();

      const header = render(<PrimitivesPanel variant="header" />);
      expect(header.container.querySelector(".absolute")).toBeNull();
      expect(header.container.querySelector(".rounded-2xl")).toBeNull();
      expect(header.container.querySelector(".border-border-default")).toBeNull();
    });

    it("keeps every tool, chevron and label in the header variant", () => {
      render(<PrimitivesPanel variant="header" />);
      expect(screen.getAllByRole("button", { name: "Embed" })).toHaveLength(1);
      const chevrons = screen
        .getAllByRole("button")
        .filter((b) => /^More /.test(b.getAttribute("aria-label") ?? ""))
        .map((b) => b.getAttribute("aria-label"));
      expect(chevrons).toEqual(["More move tools", "More shapes", "More pen tools"]);
    });

    it("marks the active tool as pressed and toggles it on click", () => {
      render(<PrimitivesPanel variant="header" />);
      const embed = screen.getByRole("button", { name: "Embed" });
      expect(embed.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(embed);
      expect(useDrawModeStore.getState().activeTool).toBe("embed");
      expect(screen.getByRole("button", { name: "Embed" }).getAttribute("aria-pressed")).toBe("true");
    });

    it("uses 28px buttons", () => {
      render(<PrimitivesPanel variant="header" />);
      expect(screen.getByRole("button", { name: "Embed" }).className).toContain("size-7");
    });
  });
});
