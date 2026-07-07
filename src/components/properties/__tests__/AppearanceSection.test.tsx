import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AppearanceSection } from "../AppearanceSection";
import type { SceneNode } from "@/types/scene";

function makeNode(extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id: "n1",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...extra,
  } as SceneNode;
}

afterEach(() => cleanup());

describe("<AppearanceSection />", () => {
  it("renders the section title and opacity for any node", () => {
    render(<AppearanceSection node={makeNode({ opacity: 0.5 })} onUpdate={vi.fn()} />);
    expect(screen.getByText("Appearance")).toBeTruthy();
    // Opacity 0.5 -> 50%.
    const opacity = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
    expect(opacity.value).toBe("50");
  });

  it("defaults opacity display to 100% when unset", () => {
    render(<AppearanceSection node={makeNode()} onUpdate={vi.fn()} />);
    const opacity = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
    expect(opacity.value).toBe("100");
  });

  it("updates opacity (percent clamped to 0..1) on edit", () => {
    const onUpdate = vi.fn();
    render(<AppearanceSection node={makeNode()} onUpdate={onUpdate} />);

    fireEvent.change(screen.getAllByRole("spinbutton")[0], {
      target: { value: "30" },
    });
    expect(onUpdate).toHaveBeenCalledWith({ opacity: 0.3 });
  });

  it("hides opacity when hideOpacity is set", () => {
    render(
      <AppearanceSection node={makeNode({ opacity: 0.5 })} onUpdate={vi.fn()} hideOpacity />,
    );
    // No opacity spinbutton; rect still shows the radius input though.
    const spinbuttons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    // Only the radius input remains (value 0).
    expect(spinbuttons.some((i) => i.value === "50")).toBe(false);
  });

  it("shows the unified corner radius input for a rect", () => {
    render(
      <AppearanceSection node={makeNode({ cornerRadius: 8 } as Partial<SceneNode>)} onUpdate={vi.fn()} />,
    );
    // [opacity, radius]
    const spinbuttons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(spinbuttons[1].value).toBe("8");
  });

  it("updates the unified corner radius on edit", () => {
    const onUpdate = vi.fn();
    render(
      <AppearanceSection node={makeNode({ cornerRadius: 8 } as Partial<SceneNode>)} onUpdate={onUpdate} />,
    );
    const spinbuttons = screen.getAllByRole("spinbutton");
    fireEvent.change(spinbuttons[1], { target: { value: "16" } });
    expect(onUpdate).toHaveBeenCalledWith({ cornerRadius: 16 });
  });

  it("does not render corner radius controls for a non-corner node (line)", () => {
    render(<AppearanceSection node={makeNode({ type: "line" })} onUpdate={vi.fn()} />);
    expect(screen.queryByTitle("Per corner radius")).toBeNull();
    // Only the opacity spinbutton.
    expect(screen.getAllByRole("spinbutton")).toHaveLength(1);
  });

  it("switches to per-corner mode and seeds all corners from the unified radius", () => {
    const onUpdate = vi.fn();
    render(
      <AppearanceSection node={makeNode({ cornerRadius: 12 } as Partial<SceneNode>)} onUpdate={onUpdate} />,
    );

    fireEvent.click(screen.getByTitle("Per corner radius"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0]).toMatchObject({
      cornerRadiusPerCorner: {
        topLeft: 12,
        topRight: 12,
        bottomRight: 12,
        bottomLeft: 12,
      },
      cornerRadius: undefined,
    });
  });

  it("renders TL/TR/BL/BR inputs in per-corner mode", () => {
    const node = makeNode({
      cornerRadiusPerCorner: { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 },
    } as Partial<SceneNode>);
    render(<AppearanceSection node={node} onUpdate={vi.fn()} />);

    expect(screen.getByText("TL")).toBeTruthy();
    expect(screen.getByText("TR")).toBeTruthy();
    expect(screen.getByText("BL")).toBeTruthy();
    expect(screen.getByText("BR")).toBeTruthy();
    // The toggle now offers a return to unified mode.
    expect(screen.getByTitle("Unified radius")).toBeTruthy();
  });

  it("edits a single per-corner value, merging the rest", () => {
    const onUpdate = vi.fn();
    const node = makeNode({
      cornerRadiusPerCorner: { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 },
    } as Partial<SceneNode>);
    render(<AppearanceSection node={node} onUpdate={onUpdate} />);

    // In per-corner mode the spinbuttons are [opacity, TL, TR, BL, BR].
    const spinbuttons = screen.getAllByRole("spinbutton");
    fireEvent.change(spinbuttons[1], { target: { value: "9" } }); // TL

    expect(onUpdate).toHaveBeenCalledWith({
      cornerRadiusPerCorner: { topLeft: 9, topRight: 2, bottomRight: 3, bottomLeft: 4 },
    });
  });

  it("returns to unified mode using the max of all corners", () => {
    const onUpdate = vi.fn();
    const node = makeNode({
      cornerRadiusPerCorner: { topLeft: 1, topRight: 7, bottomRight: 3, bottomLeft: 4 },
    } as Partial<SceneNode>);
    render(<AppearanceSection node={node} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByTitle("Unified radius"));

    expect(onUpdate).toHaveBeenCalledWith({
      cornerRadius: 7,
      cornerRadiusPerCorner: undefined,
    });
  });

  it("shows a Sides input for a polygon node and regenerates points on edit", () => {
    const onUpdate = vi.fn();
    const node = makeNode({ type: "polygon", sides: 6 } as Partial<SceneNode>);
    render(<AppearanceSection node={node} onUpdate={onUpdate} />);

    expect(screen.getByText("Sides")).toBeTruthy();
    // [opacity, sides] — polygons have no corner radius.
    const spinbuttons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(spinbuttons[1].value).toBe("6");

    fireEvent.change(spinbuttons[1], { target: { value: "5" } });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0] as { sides: number; points: unknown };
    expect(arg.sides).toBe(5);
    expect(Array.isArray(arg.points)).toBe(true);
  });

  it("shows a Points label instead of Sides once the node is a star", () => {
    render(
      <AppearanceSection
        node={makeNode({ type: "polygon", sides: 5, innerRadiusRatio: 0.5 } as Partial<SceneNode>)}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText("Points")).toBeTruthy();
    expect(screen.queryByText("Sides")).toBeNull();
  });

  it("toggles a polygon into a star, defaulting innerRadiusRatio to 0.5", () => {
    const onUpdate = vi.fn();
    const node = makeNode({ type: "polygon", sides: 5 } as Partial<SceneNode>);
    render(<AppearanceSection node={node} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByLabelText("Star"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0] as { innerRadiusRatio: number; points: number[] };
    expect(arg.innerRadiusRatio).toBe(0.5);
    expect(arg.points).toHaveLength(20); // 5 rays -> 10 vertices
  });

  it("toggles a star back to a plain polygon, clearing innerRadiusRatio", () => {
    const onUpdate = vi.fn();
    const node = makeNode({ type: "polygon", sides: 5, innerRadiusRatio: 0.5 } as Partial<SceneNode>);
    render(<AppearanceSection node={node} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByLabelText("Star"));

    const arg = onUpdate.mock.calls[0][0] as { innerRadiusRatio: number | undefined; points: number[] };
    expect(arg.innerRadiusRatio).toBeUndefined();
    expect(arg.points).toHaveLength(10); // 5 sides -> 5 vertices
  });

  it("edits a star's ratio, regenerating points", () => {
    const onUpdate = vi.fn();
    const node = makeNode({ type: "polygon", sides: 5, innerRadiusRatio: 0.5 } as Partial<SceneNode>);
    render(<AppearanceSection node={node} onUpdate={onUpdate} />);

    // [opacity, points, ratio]
    const spinbuttons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(spinbuttons[2], { target: { value: "30" } });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0] as { innerRadiusRatio: number };
    expect(arg.innerRadiusRatio).toBeCloseTo(0.3);
  });

  it("shows ellipse arc controls (Start/Sweep/Ratio) for an ellipse node", () => {
    render(
      <AppearanceSection
        node={makeNode({ type: "ellipse", startAngle: 10, sweepAngle: 270, innerRadiusRatio: 0.4 } as Partial<SceneNode>)}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText("Start °")).toBeTruthy();
    expect(screen.getByText("Sweep °")).toBeTruthy();
    // [opacity, start, sweep, ratio]
    const spinbuttons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(spinbuttons[1].value).toBe("10");
    expect(spinbuttons[2].value).toBe("270");
    expect(spinbuttons[3].value).toBe("40");
  });

  it("defaults ellipse Sweep to 360 and Ratio to 0", () => {
    render(<AppearanceSection node={makeNode({ type: "ellipse" } as Partial<SceneNode>)} onUpdate={vi.fn()} />);
    const spinbuttons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(spinbuttons[1].value).toBe("0");
    expect(spinbuttons[2].value).toBe("360");
    expect(spinbuttons[3].value).toBe("0");
  });

  it("updates ellipse sweepAngle, clamped to [-360, 360]", () => {
    const onUpdate = vi.fn();
    render(<AppearanceSection node={makeNode({ type: "ellipse" } as Partial<SceneNode>)} onUpdate={onUpdate} />);
    const spinbuttons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(spinbuttons[2], { target: { value: "500" } });
    expect(onUpdate).toHaveBeenCalledWith({ sweepAngle: 360 });
  });

  it("respects allTypesSupport.cornerRadius=false for mixed selections", () => {
    render(
      <AppearanceSection
        node={makeNode({ cornerRadius: 8 } as Partial<SceneNode>)}
        onUpdate={vi.fn()}
        allTypesSupport={{ cornerRadius: false }}
      />,
    );
    expect(screen.queryByTitle("Per corner radius")).toBeNull();
    // Only opacity remains.
    expect(screen.getAllByRole("spinbutton")).toHaveLength(1);
  });

  it("renders a Smoothing % input for a rect, defaulting to 0", () => {
    render(<AppearanceSection node={makeNode()} onUpdate={vi.fn()} />);
    expect(screen.getByText("Smoothing %")).toBeTruthy();
    // [opacity, radius, smoothing]
    const spinbuttons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(spinbuttons[2].value).toBe("0");
  });

  it("displays an existing cornerSmoothing fraction as a 0-100 percent", () => {
    render(
      <AppearanceSection node={makeNode({ cornerSmoothing: 0.6 } as Partial<SceneNode>)} onUpdate={vi.fn()} />,
    );
    const spinbuttons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(spinbuttons[2].value).toBe("60");
  });

  it("updates cornerSmoothing (percent clamped and converted to a 0-1 fraction) on edit", () => {
    const onUpdate = vi.fn();
    render(<AppearanceSection node={makeNode()} onUpdate={onUpdate} />);
    const spinbuttons = screen.getAllByRole("spinbutton");
    fireEvent.change(spinbuttons[2], { target: { value: "60" } });
    expect(onUpdate).toHaveBeenCalledWith({ cornerSmoothing: 0.6 });
  });

  it("still shows the Smoothing % input in per-corner mode", () => {
    const node = makeNode({
      cornerRadiusPerCorner: { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 },
      cornerSmoothing: 0.3,
    } as Partial<SceneNode>);
    render(<AppearanceSection node={node} onUpdate={vi.fn()} />);
    // [opacity, TL, TR, BL, BR, smoothing]
    const spinbuttons = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(spinbuttons[spinbuttons.length - 1].value).toBe("30");
  });

  it("does not render Smoothing % for a non-corner node (line)", () => {
    render(<AppearanceSection node={makeNode({ type: "line" })} onUpdate={vi.fn()} />);
    expect(screen.queryByText("Smoothing %")).toBeNull();
  });

  it("renders an unchecked 'Use as mask' checkbox by default", () => {
    render(<AppearanceSection node={makeNode()} onUpdate={vi.fn()} />);
    const checkbox = screen.getByLabelText("Use as mask") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("renders 'Use as mask' as checked when node.isMask is true", () => {
    render(
      <AppearanceSection node={makeNode({ isMask: true } as Partial<SceneNode>)} onUpdate={vi.fn()} />,
    );
    const checkbox = screen.getByLabelText("Use as mask") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("toggles isMask on via the 'Use as mask' checkbox", () => {
    const onUpdate = vi.fn();
    render(<AppearanceSection node={makeNode()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText("Use as mask"));
    expect(onUpdate).toHaveBeenCalledWith({ isMask: true });
  });

  it("toggles isMask off via the 'Use as mask' checkbox", () => {
    const onUpdate = vi.fn();
    render(
      <AppearanceSection node={makeNode({ isMask: true } as Partial<SceneNode>)} onUpdate={onUpdate} />,
    );
    fireEvent.click(screen.getByLabelText("Use as mask"));
    expect(onUpdate).toHaveBeenCalledWith({ isMask: false });
  });

  it("marks opacity as Mixed when listed in mixedKeys", () => {
    render(
      <AppearanceSection
        node={makeNode({ opacity: 0.5 })}
        onUpdate={vi.fn()}
        mixedKeys={new Set(["opacity"])}
      />,
    );
    const opacity = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
    expect(opacity.value).toBe("");
    expect(opacity.placeholder).toBe("Mixed");
  });
});
