import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StrokeSection } from "../StrokeSection";
import type { SceneNode } from "@/types/scene";

// The color picker is a react-aria popover with layout effects / portals that
// add nothing to this component's logic; stub it so it can't emit act()
// warnings. The ColorInput still renders its plain text <input> for the hex
// value, which is what we assert on.
vi.mock("@/components/ui/ColorPicker", () => ({
  CustomColorPicker: () => null,
}));

function makeNode(extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id: "n1",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    ...extra,
  } as SceneNode;
}

// Shared no-op overrides plumbing — most tests don't exercise component
// instances, so override detection is off and resetOverride is never called.
const noOverride = <T,>(_a: T | undefined, _b: T | undefined) => false;

function renderSection(node: SceneNode, props: Partial<React.ComponentProps<typeof StrokeSection>> = {}) {
  const onUpdate = props.onUpdate ?? vi.fn();
  render(
    <StrokeSection
      node={node}
      onUpdate={onUpdate}
      component={props.component ?? null}
      colorVariables={props.colorVariables ?? []}
      activeTheme={props.activeTheme ?? "light"}
      isOverridden={props.isOverridden ?? noOverride}
      resetOverride={props.resetOverride ?? vi.fn()}
      mixedKeys={props.mixedKeys}
    />,
  );
  return onUpdate;
}

afterEach(() => cleanup());

describe("<StrokeSection />", () => {
  describe("empty state (no stroke)", () => {
    it("renders only an add button and no stroke controls", () => {
      renderSection(makeNode());
      // No color text input / spinbuttons when there is no stroke.
      expect(screen.queryByRole("spinbutton")).toBeNull();
      expect(screen.queryByText("Weight")).toBeNull();
      // Single ghost action button (the "+").
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBe(1);
    });

    it("adds a default stroke when the add button is clicked", () => {
      const onUpdate = renderSection(makeNode());
      fireEvent.click(screen.getAllByRole("button")[0]);
      expect(onUpdate).toHaveBeenCalledWith({ stroke: "#000000", strokeWidth: 1 });
    });
  });

  describe("unified stroke", () => {
    function unifiedNode(extra: Partial<SceneNode> = {}) {
      return makeNode({
        stroke: "#ff0000",
        strokeWidth: 4,
        strokeAlign: "outside",
        strokeOpacity: 0.5,
        ...extra,
      });
    }

    it("renders current color, opacity, align and weight", () => {
      renderSection(unifiedNode());

      // Hex text input.
      const hex = screen.getByDisplayValue("#ff0000") as HTMLInputElement;
      expect(hex.value).toBe("#ff0000");

      // Two spinbuttons in unified mode: [opacity %, weight].
      const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
      expect(inputs[0].value).toBe("50"); // opacity 0.5 -> 50%
      expect(inputs[1].value).toBe("4"); // weight

      // Selected select labels render as text.
      expect(screen.getByText("Outside")).toBeTruthy();
      expect(screen.getByText("Unified")).toBeTruthy();
    });

    it("emits a hex color change", () => {
      const onUpdate = renderSection(unifiedNode());
      const hex = screen.getByDisplayValue("#ff0000");
      fireEvent.change(hex, { target: { value: "#00ff00" } });
      expect(onUpdate).toHaveBeenCalledWith({ stroke: "#00ff00" });
    });

    it("converts an opacity edit from percent to a 0..1 fraction", () => {
      const onUpdate = renderSection(unifiedNode());
      const inputs = screen.getAllByRole("spinbutton");
      fireEvent.change(inputs[0], { target: { value: "20" } });
      expect(onUpdate).toHaveBeenCalledWith({ strokeOpacity: 0.2 });
    });

    it("emits a weight change", () => {
      const onUpdate = renderSection(unifiedNode());
      const inputs = screen.getAllByRole("spinbutton");
      fireEvent.change(inputs[1], { target: { value: "8" } });
      expect(onUpdate).toHaveBeenCalledWith({ strokeWidth: 8 });
    });

    it("removes the stroke when the remove button is clicked", () => {
      const onUpdate = renderSection(unifiedNode());
      // Header action is the first button.
      fireEvent.click(screen.getAllByRole("button")[0]);
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          stroke: undefined,
          strokeWidth: undefined,
          strokeAlign: undefined,
          strokeBinding: undefined,
          strokeOpacity: undefined,
          strokeWidthPerSide: undefined,
        }),
      );
    });

    it("defaults opacity display to 100% when unset", () => {
      renderSection(makeNode({ stroke: "#000000", strokeWidth: 2 }));
      const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
      expect(inputs[0].value).toBe("100");
    });
  });

  describe("per-side stroke", () => {
    function perSideNode() {
      return makeNode({
        stroke: "#000000",
        strokeWidthPerSide: { top: 1, right: 2, bottom: 3, left: 4 },
      });
    }

    it("renders T/R/B/L inputs and hides the unified weight", () => {
      renderSection(perSideNode());
      // Opacity + 4 per-side inputs = 5 spinbuttons; no unified weight input.
      const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
      expect(inputs.length).toBe(5);
      expect(inputs[1].value).toBe("1"); // top
      expect(inputs[2].value).toBe("2"); // right
      expect(inputs[3].value).toBe("3"); // bottom
      expect(inputs[4].value).toBe("4"); // left
      expect(screen.getByText("Per Side")).toBeTruthy();
    });

    it("emits a merged per-side object when one side changes", () => {
      const onUpdate = renderSection(perSideNode());
      const inputs = screen.getAllByRole("spinbutton");
      fireEvent.change(inputs[2], { target: { value: "10" } }); // right
      expect(onUpdate).toHaveBeenCalledWith({
        strokeWidthPerSide: { top: 1, right: 10, bottom: 3, left: 4 },
      });
    });
  });

  describe("mode + node-type behaviour", () => {
    it("detects unified mode (single weight input, Mode shows Unified)", () => {
      // We can't drive the base-ui Select dropdown directly, so we assert the
      // mode that getStrokeMode() resolved to via the rendered UI: a unified
      // node shows the single "Weight" input and the "Unified" label.
      renderSection(makeNode({ stroke: "#000", strokeWidth: 6 }));
      expect(screen.getByText("Weight")).toBeTruthy();
      expect(screen.getByText("Unified")).toBeTruthy();
      // Unified mode => exactly opacity + weight spinbuttons.
      expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
    });

    it("omits the Mode select for ellipses (per-side unsupported)", () => {
      renderSection(makeNode({ type: "ellipse", stroke: "#000", strokeWidth: 2 } as Partial<SceneNode>));
      expect(screen.queryByText("Unified")).toBeNull();
      expect(screen.queryByText("Per Side")).toBeNull();
      // Align select still present.
      expect(screen.getByText("Center")).toBeTruthy();
    });
  });

  describe("line arrowhead caps", () => {
    function lineNode(extra: Partial<SceneNode> = {}) {
      return makeNode({
        type: "line",
        stroke: "#000000",
        strokeWidth: 2,
        points: [0, 0, 100, 0],
        ...extra,
      } as Partial<SceneNode>);
    }

    it("shows Start cap / End cap selects for a line, defaulting to None", () => {
      renderSection(lineNode());
      expect(screen.getByText("Start cap")).toBeTruthy();
      expect(screen.getByText("End cap")).toBeTruthy();
      expect(screen.getAllByText("None")).toHaveLength(2);
    });

    it("reflects existing cap values", () => {
      renderSection(lineNode({ startCap: "arrow", endCap: "circle" } as Partial<SceneNode>));
      expect(screen.getByText("Arrow")).toBeTruthy();
      expect(screen.getByText("Circle")).toBeTruthy();
    });

    it("does not show cap selects for non-line nodes", () => {
      renderSection(makeNode({ type: "ellipse", stroke: "#000", strokeWidth: 2 } as Partial<SceneNode>));
      expect(screen.queryByText("Start cap")).toBeNull();
      expect(screen.queryByText("End cap")).toBeNull();
    });
  });

  describe("mixed keys", () => {
    it("shows a Mixed color swatch and empty mixed spinbuttons", () => {
      renderSection(
        makeNode({ stroke: "#ff0000", strokeWidth: 4, strokeOpacity: 0.5 }),
        { mixedKeys: new Set(["stroke", "strokeOpacity", "strokeWidth"]) },
      );
      // ColorInput renders the "Mixed" label instead of a hex input.
      expect(screen.getByText("Mixed")).toBeTruthy();
      expect(screen.queryByDisplayValue("#ff0000")).toBeNull();

      const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
      expect(inputs[0].value).toBe(""); // opacity mixed
      expect(inputs[0].placeholder).toBe("Mixed");
      expect(inputs[1].value).toBe(""); // weight mixed
    });
  });

  describe("component overrides", () => {
    it("renders a reset control when stroke is overridden and calls resetOverride", () => {
      const resetOverride = vi.fn();
      const component = makeNode({ stroke: "#0000ff" });
      render(
        <StrokeSection
          node={makeNode({ stroke: "#ff0000", strokeWidth: 4 })}
          onUpdate={vi.fn()}
          component={component}
          colorVariables={[]}
          activeTheme="light"
          // Mark only the `stroke` property as overridden.
          isOverridden={(instanceVal) => instanceVal === "#ff0000"}
          resetOverride={resetOverride}
        />,
      );
      const resetBtn = screen.getByTitle("Reset to component value");
      fireEvent.click(resetBtn);
      expect(resetOverride).toHaveBeenCalledWith("stroke");
    });
  });

  describe("path stroke migration", () => {
    it("migrates legacy pathStroke to base props on first edit", () => {
      const onUpdate = renderSection(
        makeNode({
          type: "path",
          pathStroke: { fill: "#123456", thickness: 3, align: "inside" },
        } as Partial<SceneNode>),
      );
      // The hex input reflects the pathStroke fill.
      const hex = screen.getByDisplayValue("#123456");
      fireEvent.change(hex, { target: { value: "#abcdef" } });
      // First edit should carry the migrated base props plus the new value.
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          stroke: "#abcdef",
          strokeWidth: 3,
          strokeAlign: "inside",
          pathStroke: undefined,
        }),
      );
    });
  });
});
