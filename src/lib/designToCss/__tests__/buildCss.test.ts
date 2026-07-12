import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedVariables } from "@/test/fixtures";
import { useVariableStore } from "@/store/variableStore";
import { buildCssForNodes } from "../buildCss";
import type { FlatFrameNode, FlatSceneNode, GradientPaint, RectNode, ShadowEffect } from "@/types/scene";

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

function autoLayoutFrame(): FlatFrameNode {
  return {
    id: "frame1",
    type: "frame",
    name: "Row",
    x: 0,
    y: 0,
    width: 300,
    height: 60,
    fill: "#ffffff",
    layout: {
      autoLayout: true,
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 8,
      paddingLeft: 16,
    },
  } as unknown as FlatFrameNode;
}

describe("buildCssForNodes", () => {
  beforeEach(() => {
    resetStores();
  });

  it("generates a CSS block for a rect with a gradient fill and drop shadow", () => {
    const node = gradientRect();
    const { css, warnings } = buildCssForNodes(["rect1"], { rect1: node });

    expect(warnings).toEqual([]);
    expect(css).toMatchSnapshot();
    expect(css).toContain("/* Card */");
    expect(css).toContain(".card {");
    expect(css).toContain("background-image: linear-gradient(");
    expect(css).toContain("box-shadow: 0px 4px 8px 0px #00000040");
    expect(css).toContain("border-radius: 12px");
  });

  it("generates flexbox CSS for an auto-layout frame", () => {
    const node = autoLayoutFrame();
    const { css } = buildCssForNodes(["frame1"], { frame1: node });

    expect(css).toMatchSnapshot();
    expect(css).toContain("display: flex");
    expect(css).toContain("flex-direction: row");
    expect(css).toContain("gap: 12px");
    expect(css).toContain("align-items: center");
    expect(css).toContain("justify-content: space-between");
    expect(css).toContain("padding: 8px 16px");
  });

  it("emits var(--token) and a :root tokens block for a bound fill", () => {
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

    const { css } = buildCssForNodes(["rect1"], { rect1: node });

    expect(css).toContain(":root {");
    expect(css).toContain("--primary: #3366ff;");
    expect(css).toContain("background-color: var(--primary, #3366ff);");
  });

  it("does not emit a :root block when nothing is bound to a variable", () => {
    seedVariables();
    const node = gradientRect();
    const { css } = buildCssForNodes(["rect1"], { rect1: node });
    expect(css).not.toContain(":root {");
  });

  it("emits one block per node for a multi-selection with unique class names", () => {
    const a: FlatSceneNode = {
      id: "a",
      type: "rect",
      name: "Button",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      fill: "#ff0000",
    } as unknown as FlatSceneNode;
    const b: FlatSceneNode = {
      id: "b",
      type: "rect",
      name: "Button",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      fill: "#00ff00",
    } as unknown as FlatSceneNode;

    const { css, warnings } = buildCssForNodes(["a", "b"], { a, b });

    expect(warnings).toEqual([]);
    expect(css).toContain(".button {");
    expect(css).toContain(".button-2 {");
    const headerCount = (css.match(/\/\* Button \*\//g) ?? []).length;
    expect(headerCount).toBe(2);
  });

  it("reports a warning and skips missing node ids", () => {
    const { css, warnings } = buildCssForNodes(["missing"], {});
    expect(warnings).toEqual(["Node not found: missing"]);
    expect(css).toBe("");
  });

  it("neutralizes */ in a node name so it cannot close the CSS comment", () => {
    const node: FlatSceneNode = {
      id: "rect1",
      type: "rect",
      name: "Evil */ *{background:url(https://evil/?x)} /*",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      fill: "#ff0000",
    } as unknown as FlatSceneNode;

    const { css } = buildCssForNodes(["rect1"], { rect1: node });

    // The comment must stay closed by our own emitted "*/" only — the
    // node-supplied "*/" must be neutralized so it can't terminate the
    // comment early and leak a live "*{...}" rule into the stylesheet.
    const commentMatches = css.match(/\/\*[\s\S]*?\*\//g);
    expect(commentMatches).not.toBeNull();
    // The malicious name must not split into two comments (i.e. its "*/"
    // must not close the comment early) — there should be exactly one
    // comment for this single node.
    expect(commentMatches).toHaveLength(1);
    // The injected rule must not appear as a live (uncommented) CSS rule.
    const liveCss = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(liveCss).not.toContain("url(https://evil/?x)");
  });

  it("ignores unrelated variables in the store beyond the referenced one", () => {
    useVariableStore.setState({
      variables: [
        { id: "var-primary", name: "--primary", type: "color", value: "#3366ff" },
        { id: "var-unused", name: "--unused", type: "color", value: "#000000" },
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
        { id: "p1", type: "solid", color: "#3366ff", colorBinding: { variableId: "var-primary" } },
      ],
    } as unknown as RectNode;

    const { css } = buildCssForNodes(["rect1"], { rect1: node });
    expect(css).toContain("--primary");
    expect(css).not.toContain("--unused");
  });
});
