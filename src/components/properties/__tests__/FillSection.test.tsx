import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FillSection } from "../FillSection";
import type { Paint, SceneNode } from "@/types/scene";

// The gradient/image editors open portals / run their own effects and are not
// the unit under test here — stub them out so they don't pollute the DOM or
// emit act() warnings. The solid color row stays real (its text input is the
// stable lever we drive).
vi.mock("@/components/properties/GradientEditor", () => ({
  GradientEditor: () => <div data-testid="gradient-editor" />,
}));
vi.mock("@/components/properties/ImageFillSection", () => ({
  ImageFillEditor: () => <div data-testid="image-editor" />,
}));

const noop = vi.fn();

function solid(id: string, color: string, extra: Partial<Paint> = {}): Paint {
  return { id, type: "solid", color, ...extra } as Paint;
}

function makeNode(fills: Paint[], type: SceneNode["type"] = "rect"): SceneNode {
  return { id: "n1", type, x: 0, y: 0, width: 100, height: 100, fills } as SceneNode;
}

function baseProps(node: SceneNode, onUpdate = vi.fn()) {
  return {
    node,
    onUpdate,
    component: null,
    colorVariables: [],
    activeTheme: "light" as const,
    isOverridden: () => false,
    resetOverride: noop,
  };
}

afterEach(() => cleanup());

describe("<FillSection />", () => {
  it("renders nothing for an empty fill stack but keeps the Add button", () => {
    render(<FillSection {...baseProps(makeNode([]))} />);
    expect(screen.getByTitle("Add fill")).toBeTruthy();
    expect(screen.queryByText("Mixed")).toBeNull();
    // No paint rows -> no remove buttons.
    expect(screen.queryByTitle("Remove fill")).toBeNull();
  });

  it("renders a row per fill with its current color value", () => {
    render(
      <FillSection {...baseProps(makeNode([solid("a", "#ff0000"), solid("b", "#00ff00")]))} />,
    );
    const colorInputs = screen.getAllByPlaceholderText("#000000") as HTMLInputElement[];
    // Two solid rows -> two color text inputs. Rows render top-of-stack first,
    // so the last array element ("#00ff00") renders before "#ff0000".
    expect(colorInputs).toHaveLength(2);
    expect(colorInputs[0].value).toBe("#00ff00");
    expect(colorInputs[1].value).toBe("#ff0000");
  });

  it("renders the opacity as a rounded percentage", () => {
    render(<FillSection {...baseProps(makeNode([solid("a", "#ff0000", { opacity: 0.5 })]))} />);
    const opacity = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(opacity.value).toBe("50");
  });

  it("adds a solid fill via the Add button", () => {
    const onUpdate = vi.fn();
    render(<FillSection {...baseProps(makeNode([]), onUpdate)} />);

    fireEvent.click(screen.getByTitle("Add fill"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0];
    expect(arg.fills).toHaveLength(1);
    expect(arg.fills[0]).toMatchObject({ type: "solid", color: "#cccccc" });
    // Legacy single-fill props are cleared in the same update.
    expect(arg).toMatchObject({
      fill: undefined,
      gradientFill: undefined,
      imageFill: undefined,
    });
  });

  it("updates a fill color when the text input changes", () => {
    const onUpdate = vi.fn();
    render(<FillSection {...baseProps(makeNode([solid("a", "#ff0000")]), onUpdate)} />);

    const input = screen.getByPlaceholderText("#000000");
    fireEvent.change(input, { target: { value: "#123456" } });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].fills[0]).toMatchObject({
      id: "a",
      color: "#123456",
    });
  });

  it("updates opacity (clamped, stored 0-1) when the percentage changes", () => {
    const onUpdate = vi.fn();
    render(<FillSection {...baseProps(makeNode([solid("a", "#ff0000")]), onUpdate)} />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "40" } });

    expect(onUpdate.mock.calls[0][0].fills[0]).toMatchObject({ opacity: 0.4 });
  });

  it("removes a fill", () => {
    const onUpdate = vi.fn();
    render(
      <FillSection {...baseProps(makeNode([solid("a", "#ff0000"), solid("b", "#00ff00")]), onUpdate)} />,
    );

    // First rendered row is top-of-stack = array index 1 ("b").
    fireEvent.click(screen.getAllByTitle("Remove fill")[0]);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const remaining = onUpdate.mock.calls[0][0].fills as Paint[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("a");
  });

  it("toggles fill visibility", () => {
    const onUpdate = vi.fn();
    render(<FillSection {...baseProps(makeNode([solid("a", "#ff0000")]), onUpdate)} />);

    // Visible by default -> button reads "Hide fill".
    fireEvent.click(screen.getByTitle("Hide fill"));
    expect(onUpdate.mock.calls[0][0].fills[0]).toMatchObject({ visible: false });
  });

  it("reorders fills with the move buttons", () => {
    const onUpdate = vi.fn();
    render(
      <FillSection {...baseProps(makeNode([solid("a", "#ff0000"), solid("b", "#00ff00")]), onUpdate)} />,
    );

    // The bottom-of-stack row ("a", array index 0) can move up; it's the second
    // rendered row, so its "Move up" button is the last one.
    const moveUps = screen.getAllByTitle("Move up");
    fireEvent.click(moveUps[moveUps.length - 1]);

    const reordered = onUpdate.mock.calls[0][0].fills as Paint[];
    // "a" moved toward the top (end of array): order is now [b, a].
    expect(reordered.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("disables the move-up button for the topmost fill", () => {
    render(
      <FillSection {...baseProps(makeNode([solid("a", "#ff0000"), solid("b", "#00ff00")]))} />,
    );
    // First rendered row is the top of the stack -> cannot move up further.
    const moveUps = screen.getAllByTitle("Move up") as HTMLButtonElement[];
    expect(moveUps[0].disabled).toBe(true);
    // The bottom row can move up.
    expect(moveUps[moveUps.length - 1].disabled).toBe(false);
  });

  it("shows the current fill kind label in the type selector", () => {
    // base-ui Select dropdowns are flaky in happy-dom, so assert the selected
    // value's label text renders rather than driving the dropdown open.
    render(<FillSection {...baseProps(makeNode([solid("a", "#ff0000")]))} />);
    expect(screen.getByText("Solid")).toBeTruthy();
  });

  it("renders the gradient editor (stubbed) for a gradient fill", () => {
    const gradientFill = {
      id: "g",
      type: "gradient",
      gradient: {
        type: "linear",
        angle: 0,
        stops: [
          { color: "#000000", position: 0 },
          { color: "#ffffff", position: 1 },
        ],
      },
    } as unknown as Paint;
    render(<FillSection {...baseProps(makeNode([gradientFill]))} />);
    expect(screen.getByTestId("gradient-editor")).toBeTruthy();
    // Gradient rows have no caret toggle (only solids collapse).
    expect(screen.queryByTitle(/Collapse|Expand/)).toBeNull();
  });

  it("renders the image editor (stubbed) for an image fill on image-capable nodes", () => {
    const imageFill = {
      id: "i",
      type: "image",
      image: { url: "http://x/y.png", mode: "fill" },
    } as Paint;
    render(<FillSection {...baseProps(makeNode([imageFill], "frame"))} />);
    expect(screen.getByTestId("image-editor")).toBeTruthy();
  });

  it("collapses a solid row's blend-mode select via the caret toggle", () => {
    render(<FillSection {...baseProps(makeNode([solid("a", "#ff0000")]))} />);

    // Expanded by default? No: solid rows start collapsed (the caret reads
    // "Expand"), so the blend select is hidden initially.
    expect(screen.getByTitle("Expand")).toBeTruthy();
    expect(screen.queryByText("Blend")).toBeNull();

    fireEvent.click(screen.getByTitle("Expand"));
    expect(screen.getByText("Blend")).toBeTruthy();
    expect(screen.getByTitle("Collapse")).toBeTruthy();
  });

  it("shows a Mixed placeholder when fills are mixed across the selection", () => {
    render(
      <FillSection
        {...baseProps(makeNode([solid("a", "#ff0000")]))}
        mixedKeys={new Set(["fills"])}
      />,
    );
    expect(screen.getByText("Mixed")).toBeTruthy();
    // No editable rows are rendered in mixed mode.
    expect(screen.queryByPlaceholderText("#000000")).toBeNull();
  });

  it("shows the override reset control for the top solid row when overridden", () => {
    const onReset = vi.fn();
    render(
      <FillSection
        {...baseProps(makeNode([solid("a", "#ff0000")]))}
        component={{ id: "c", type: "rect", fill: "#0000ff" } as SceneNode}
        isOverridden={() => true}
        resetOverride={onReset}
      />,
    );
    const reset = screen.getByTitle("Reset to component value");
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalledWith("fill");
  });

  it("renders solid rows on non-image-capable nodes (e.g. line)", () => {
    render(<FillSection {...baseProps(makeNode([solid("a", "#ff0000")], "line"))} />);
    expect(screen.getByPlaceholderText("#000000")).toBeTruthy();
  });
});
