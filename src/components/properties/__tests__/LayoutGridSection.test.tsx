import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LayoutGridSection } from "../LayoutGridSection";
import type { FrameNode, LayoutGridConfig, SceneNode } from "@/types/scene";

// ColorInput inside the popover mounts CustomColorPicker (portal/popover with
// effects); stub it so the popover DOM stays deterministic. The hex <input>
// remains for the grid color.
vi.mock("@/components/ui/ColorPicker", () => ({
  CustomColorPicker: () => null,
}));

function grid(extra: Partial<LayoutGridConfig> = {}): LayoutGridConfig {
  return {
    id: "g1",
    type: "columns",
    visible: true,
    color: "#FF0000",
    opacity: 0.1,
    count: 5,
    gutter: 20,
    margin: 0,
    width: null,
    alignment: "stretch",
    ...extra,
  };
}

function makeFrame(grids?: LayoutGridConfig[]): FrameNode {
  return {
    id: "frame1",
    type: "frame",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    ...(grids ? { layoutGrids: grids } : {}),
  } as unknown as FrameNode;
}

afterEach(() => cleanup());

describe("<LayoutGridSection />", () => {
  it("renders the section title and an add button with no grids", () => {
    render(<LayoutGridSection node={makeFrame()} onUpdate={vi.fn()} />);
    expect(screen.getByText("Layout grid")).toBeTruthy();
    // No grid summary rows.
    expect(screen.queryByLabelText("Remove grid")).toBeNull();
  });

  it("adds a default columns grid via the add button", () => {
    const onUpdate = vi.fn();
    render(<LayoutGridSection node={makeFrame()} onUpdate={onUpdate} />);

    // The add button is the section header action — the first button.
    fireEvent.click(screen.getAllByRole("button")[0]);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0] as Partial<SceneNode> & {
      layoutGrids: LayoutGridConfig[];
    };
    expect(arg.layoutGrids).toHaveLength(1);
    expect(arg.layoutGrids[0]).toMatchObject({ type: "columns", count: 5 });
  });

  it("renders a summary row for an existing columns grid", () => {
    render(
      <LayoutGridSection node={makeFrame([grid()])} onUpdate={vi.fn()} />,
    );
    // Stretch + null width => "5 columns (Auto)".
    expect(screen.getByText("5 columns (Auto)")).toBeTruthy();
    expect(screen.getByLabelText("Remove grid")).toBeTruthy();
  });

  it("summarizes a grid-type config by its cell size", () => {
    render(
      <LayoutGridSection
        node={makeFrame([grid({ type: "grid", size: 12 })])}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText("Grid 12px")).toBeTruthy();
  });

  it("removes a grid via the remove button (clears layoutGrids when last)", () => {
    const onUpdate = vi.fn();
    render(
      <LayoutGridSection node={makeFrame([grid()])} onUpdate={onUpdate} />,
    );

    fireEvent.click(screen.getByLabelText("Remove grid"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    // Removing the only grid -> layoutGrids becomes undefined.
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ layoutGrids: undefined });
  });

  it("toggles grid visibility", () => {
    const onUpdate = vi.fn();
    render(
      <LayoutGridSection node={makeFrame([grid({ visible: true })])} onUpdate={onUpdate} />,
    );

    fireEvent.click(screen.getByLabelText("Hide grid"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0] as { layoutGrids: LayoutGridConfig[] };
    expect(arg.layoutGrids[0].visible).toBe(false);
  });

  it("shows the 'Show grid' control when hidden and toggles it back on", () => {
    const onUpdate = vi.fn();
    render(
      <LayoutGridSection node={makeFrame([grid({ visible: false })])} onUpdate={onUpdate} />,
    );

    fireEvent.click(screen.getByLabelText("Show grid"));

    const arg = onUpdate.mock.calls[0][0] as { layoutGrids: LayoutGridConfig[] };
    expect(arg.layoutGrids[0].visible).toBe(true);
  });

  it("opens a popover with editing controls when the summary is clicked", () => {
    render(
      <LayoutGridSection node={makeFrame([grid()])} onUpdate={vi.fn()} />,
    );

    fireEvent.click(screen.getByText("5 columns (Auto)"));

    // Popover portals to body and shows Type/Count/Color/Opacity/Align labels.
    expect(screen.getByText("Count")).toBeTruthy();
    expect(screen.getByText("Color")).toBeTruthy();
    expect(screen.getByText("Align")).toBeTruthy();
  });

  it("edits the column count from the popover", () => {
    const onUpdate = vi.fn();
    render(
      <LayoutGridSection node={makeFrame([grid({ count: 5 })])} onUpdate={onUpdate} />,
    );

    fireEvent.click(screen.getByText("5 columns (Auto)"));

    // First spinbutton in the popover is the Count input.
    const spinbuttons = screen.getAllByRole("spinbutton");
    fireEvent.change(spinbuttons[0], { target: { value: "8" } });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0] as { layoutGrids: LayoutGridConfig[] };
    expect(arg.layoutGrids[0].count).toBe(8);
  });

  it("edits the grid color from the popover", () => {
    const onUpdate = vi.fn();
    render(
      <LayoutGridSection node={makeFrame([grid({ color: "#FF0000" })])} onUpdate={onUpdate} />,
    );

    fireEvent.click(screen.getByText("5 columns (Auto)"));

    // With CustomColorPicker stubbed, the popover's hex <input> drives the color.
    fireEvent.change(screen.getByDisplayValue("#FF0000"), {
      target: { value: "#00FF00" },
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0] as { layoutGrids: LayoutGridConfig[] };
    expect(arg.layoutGrids[0].color).toBe("#00FF00");
  });
});
