import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
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

// The per-fill detail editor now lives in a base-ui popover, which portals and
// is flaky to drive open in happy-dom. Render trigger + content inline so the
// detail controls (type select, color, blend, reorder) are always in the DOM —
// the same approach used for the color picker stub below.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, render }: { children?: ReactNode; render: ReactNode }) => (
    <button
      {...((render as { props?: Record<string, unknown> }).props ?? {})}
      type="button"
    >
      {children}
    </button>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

  it("exposes the blend-mode icon dropdown in the fill detail popover", () => {
    render(<FillSection {...baseProps(makeNode([solid("a", "#ff0000")]))} />);

    // Details (incl. the blend dropdown) live in the popover; there is no longer
    // an inline caret toggle on the row.
    expect(screen.queryByTitle(/Collapse|Expand/)).toBeNull();
    expect(screen.getByTitle("Blend mode: Normal")).toBeTruthy();
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

  it("shows the fill opacity as a percent in the Opacity input", () => {
    render(
      <FillSection {...baseProps(makeNode([solid("a", "#ff0000", { opacity: 0.5 })]))} />,
    );
    expect(screen.getByText("Opacity")).toBeTruthy();
    const opacityInput = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(opacityInput.value).toBe("50");
  });

  it("defaults the Opacity input to 100 when the paint has no opacity", () => {
    render(<FillSection {...baseProps(makeNode([solid("a", "#ff0000")]))} />);
    const opacityInput = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(opacityInput.value).toBe("100");
  });

  it("updates fill opacity when the Opacity input changes", () => {
    const onUpdate = vi.fn();
    render(
      <FillSection
        {...baseProps(makeNode([solid("a", "#ff0000", { opacity: 0.5 })]), onUpdate)}
      />,
    );

    const opacityInput = screen.getByRole("spinbutton");
    fireEvent.change(opacityInput, { target: { value: "25" } });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0];
    expect(arg.fills[0]).toMatchObject({ id: "a", opacity: 0.25 });
    expect(arg).toMatchObject({
      fill: undefined,
      gradientFill: undefined,
      imageFill: undefined,
    });
  });
});
