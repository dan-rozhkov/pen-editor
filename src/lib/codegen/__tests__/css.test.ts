import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedVariables } from "@/test/fixtures";
import { useVariableStore } from "@/store/variableStore";
import { buildCssCode } from "../css";
import type { FlatFrameNode, GradientPaint, RectNode, ShadowEffect } from "@/types/scene";

function gradientRect(): RectNode {
  const gradient: GradientPaint = {
    id: "p1",
    type: "gradient",
    gradient: {
      type: "linear",
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 1,
      stops: [
        { position: 0, color: "#ff0000" },
        { position: 1, color: "#0000ff" },
      ],
    },
  };
  const shadow: ShadowEffect = {
    type: "shadow",
    shadowType: "outer",
    color: "#00000040",
    offset: { x: 0, y: 4 },
    blur: 8,
    spread: 0,
    id: "e1",
  };
  return {
    id: "rect1",
    type: "rect",
    name: "Card",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    cornerRadius: 12,
    fills: [gradient],
    effects: [shadow],
  } as unknown as RectNode;
}

function wrapFrame(): FlatFrameNode {
  return {
    id: "frame2",
    type: "frame",
    name: "Wrap Row",
    x: 0,
    y: 0,
    width: 300,
    height: 60,
    fill: "#ffffff",
    // Frame-level sizing clamps only take effect for a *flex child* inside
    // an auto-layout parent (generateFlexChildStyles) — buildCssForNodes
    // always calls generateLayoutStyles with isRoot=true, so these clamps
    // are deliberately not expected to appear in the output below; the
    // assertions document that current (correct-per-reuse) limitation.
    sizing: { minWidth: 100, maxWidth: 400 },
    layout: {
      autoLayout: true,
      flexDirection: "row",
      flexWrap: true,
      gap: -8,
      paddingTop: 4,
      paddingRight: 4,
      paddingBottom: 4,
      paddingLeft: 4,
    },
  } as unknown as FlatFrameNode;
}

describe("buildCssCode", () => {
  beforeEach(() => {
    resetStores();
  });

  it("(a) generates px CSS for a gradient+shadow+radius rect", () => {
    const node = gradientRect();
    const { code, warnings } = buildCssCode(["rect1"], { rect1: node }, { units: "px", remBase: 16 });

    expect(warnings).toEqual([]);
    expect(code).toMatchSnapshot();
    expect(code).toContain("width: 200px");
    expect(code).toContain("height: 100px");
    expect(code).toContain("border-radius: 12px");
    expect(code).toContain("box-shadow: 0px 4px 8px 0px #00000040");
  });

  it("(b) generates rem CSS for the same rect (remBase 16)", () => {
    const node = gradientRect();
    const { code, warnings } = buildCssCode(["rect1"], { rect1: node }, { units: "rem", remBase: 16 });

    expect(warnings).toEqual([]);
    expect(code).toMatchSnapshot();
    // 200/16 = 12.5, 100/16 = 6.25, 12/16 = 0.75
    expect(code).toContain("width: 12.5rem");
    expect(code).toContain("height: 6.25rem");
    expect(code).toContain("border-radius: 0.75rem");
    // 0px stays "0" (no unit); 4/16 = 0.25, 8/16 = 0.5
    expect(code).toContain("box-shadow: 0 0.25rem 0.5rem 0 #00000040");
    expect(code).not.toContain("px");
  });

  it("(c) generates flexbox CSS for an auto-layout frame with wrap/min-max/negative gap", () => {
    const node = wrapFrame();
    const { code } = buildCssCode(["frame2"], { frame2: node }, { units: "px", remBase: 16 });

    expect(code).toMatchSnapshot();
    expect(code).toContain("display: flex");
    expect(code).toContain("flex-wrap: wrap");
    // Negative single-axis gap is never emitted (CSS gap can't be negative).
    expect(code).not.toContain("gap:");
    // Sizing clamps on the node itself (not a flex child of an auto-layout
    // parent) are not emitted by the underlying generator — see comment in
    // wrapFrame() above.
    expect(code).not.toContain("min-width");
    expect(code).not.toContain("max-width");
  });

  it("(d) emits var(--token) and a :root tokens block for a bound fill", () => {
    seedVariables();
    const node: RectNode = {
      id: "rect1",
      type: "rect",
      name: "Button",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      fills: [
        {
          id: "p1",
          type: "solid",
          color: "#3366ff",
          colorBinding: { variableId: "var-primary" },
        },
      ],
    } as unknown as RectNode;

    const { code } = buildCssCode(["rect1"], { rect1: node }, { units: "px", remBase: 16 });

    expect(code).toContain(":root {");
    expect(code).toContain("--primary: #3366ff;");
    expect(code).toContain("background-color: var(--primary, #3366ff);");
  });

  it("(d2) converts px lengths to rem even inside var() fallbacks", () => {
    seedVariables();
    const node: RectNode = {
      id: "rect1",
      type: "rect",
      name: "Button",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      cornerRadius: 16,
      fills: [
        {
          id: "p1",
          type: "solid",
          color: "#3366ff",
          colorBinding: { variableId: "var-primary" },
        },
      ],
    } as unknown as RectNode;

    const { code } = buildCssCode(["rect1"], { rect1: node }, { units: "rem", remBase: 16 });

    expect(code).toContain("border-radius: 1rem");
    expect(code).not.toContain("px");
  });

  it("(e) emits one block per node for a multi-selection with unique class names", () => {
    const a: RectNode = {
      id: "a",
      type: "rect",
      name: "Button",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      fill: "#ff0000",
    } as unknown as RectNode;
    const b: RectNode = {
      id: "b",
      type: "rect",
      name: "Button",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      fill: "#00ff00",
    } as unknown as RectNode;

    const { code, warnings } = buildCssCode(["a", "b"], { a, b }, { units: "rem", remBase: 16 });

    expect(warnings).toEqual([]);
    expect(code).toMatchSnapshot();
    expect(code).toContain(".button {");
    expect(code).toContain(".button-2 {");
    // 100/16 = 6.25, 40/16 = 2.5
    expect(code).toContain("width: 6.25rem");
    expect(code).toContain("height: 2.5rem");
  });

  it("reports a warning and skips missing node ids", () => {
    const { code, warnings } = buildCssCode(["missing"], {}, { units: "px", remBase: 16 });
    expect(warnings).toEqual(["Node not found: missing"]);
    expect(code).toBe("");
  });

  it("rounds rem to 4 decimals and strips trailing zeros", () => {
    const node: RectNode = {
      id: "rect1",
      type: "rect",
      name: "Odd",
      x: 0,
      y: 0,
      width: 100,
      height: 33,
      fill: "#ff0000",
    } as unknown as RectNode;

    const { code } = buildCssCode(["rect1"], { rect1: node }, { units: "rem", remBase: 16 });

    // 33/16 = 2.0625
    expect(code).toContain("height: 2.0625rem");
    // 100/16 = 6.25 (no trailing zeros beyond needed)
    expect(code).toContain("width: 6.25rem");
  });

  it("(f) rem mode never rewrites px-shaped text in the selector or the /* name */ comment", () => {
    const node: RectNode = {
      id: "rect1",
      type: "rect",
      name: "Button 8px",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      fill: "#ff0000",
    } as unknown as RectNode;

    const { code } = buildCssCode(["rect1"], { rect1: node }, { units: "rem", remBase: 16 });

    // Selector class name is untouched — "8px" here is part of the slug, not a CSS length.
    expect(code).toContain(".button-8px {");
    expect(code).not.toContain(".button-0.5rem");
    // Comment text is untouched too.
    expect(code).toContain("/* Button 8px */");
    // The actual declaration values still convert (sanity check the fix didn't disable conversion).
    expect(code).toContain("width: 6.25rem");
  });

  it("(g) rem mode converts a --token's value but never its name", () => {
    seedVariables();
    useVariableStore.setState({
      variables: [
        {
          id: "var-spacing",
          name: "--spacing-16px",
          type: "color",
          value: "#3366ff",
          themeValues: { light: "#3366ff", dark: "#3366ff" },
        },
      ],
    });
    const node: RectNode = {
      id: "rect1",
      type: "rect",
      name: "Button",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      fills: [
        {
          id: "p1",
          type: "solid",
          color: "#3366ff",
          colorBinding: { variableId: "var-spacing" },
        },
      ],
    } as unknown as RectNode;

    const { code } = buildCssCode(["rect1"], { rect1: node }, { units: "rem", remBase: 16 });

    // The custom-property *name* is never rewritten...
    expect(code).toContain("--spacing-16px: #3366ff;");
    expect(code).not.toContain("--spacing-1rem");
    // ...but a var() reference's px length elsewhere would still convert (width sanity check).
    expect(code).toContain("width: 6.25rem");
  });
});
