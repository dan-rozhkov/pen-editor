import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedVariables } from "@/test/fixtures";
import { useVariableStore } from "@/store/variableStore";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { makeThemeCollection, makeThemeVariable } from "@/lib/variables";
import type { Variable } from "@/types/variable";
import { buildCssForNodes } from "../buildCss";
import type { FlatFrameNode, FlatSceneNode, RectNode } from "@/types/scene";
import { boundFillButtonRect, gradientRect } from "./cssNodeFixtures";

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
    const node = boundFillButtonRect();

    const { css } = buildCssForNodes(["rect1"], { rect1: node });

    expect(css).toContain(":root {");
    expect(css).toContain("--primary: #3366ff;");
    expect(css).toContain("background-color: var(--primary, #3366ff);");
  });

  it("lists number-bound tokens in the :root block (literals stay materialized)", () => {
    seedVariables();
    const node = {
      ...autoLayoutFrame(),
      cornerRadius: 8,
      numberBindings: { cornerRadius: { variableId: "var-radius" } },
    } as FlatSceneNode;

    const { css } = buildCssForNodes(["frame1"], { frame1: node });

    expect(css).toContain(":root {");
    expect(css).toContain("--radius-m: 8;");
    expect(css).toContain("border-radius: 8px");
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

describe("buildCssForNodes mode contexts", () => {
  const primary: Variable = { ...makeThemeVariable("--primary", "#ffffff", "#000000"), id: "var-primary" };
  const accent: Variable = {
    id: "var-accent",
    name: "--accent",
    type: "color",
    collectionId: "brand",
    valuesByMode: { acme: "#aa0000", globex: "#00aa00" },
    value: "#aa0000",
  };
  const brand = {
    id: "brand",
    name: "Brand",
    modes: [
      { id: "acme", name: "Acme" },
      { id: "globex", name: "Globex" },
    ],
    defaultModeId: "acme",
  };

  function bound(id: string, variableId: string, extra: Record<string, unknown> = {}): FlatSceneNode {
    return {
      id,
      type: "frame",
      name: id,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fills: [{ id: `p-${id}`, type: "solid", color: "#123456", colorBinding: { variableId } }],
      ...extra,
    } as unknown as FlatSceneNode;
  }

  beforeEach(() => {
    resetStores();
    useVariableStore.setState({ variables: [primary, accent], collections: [makeThemeCollection(), brand] });
  });

  it("uses the document context when no frame overrides it", () => {
    const { css } = buildCssForNodes(["a"], { a: bound("a", "var-primary") });
    expect(css).toContain("--primary: #ffffff;");
  });

  it("resolves tokens in the frame's own modeOverrides", () => {
    const { css, warnings } = buildCssForNodes(["a"], { a: bound("a", "var-primary", { modeOverrides: { theme: "dark" } }) });
    expect(css).toContain("--primary: #000000;");
    expect(warnings).toEqual([]);
  });

  it("honors a legacy themeOverride", () => {
    const { css } = buildCssForNodes(["a"], { a: bound("a", "var-primary", { themeOverride: "dark" }) });
    expect(css).toContain("--primary: #000000;");
  });

  it("inherits from a dark ancestor frame", () => {
    const parent = bound("p", "var-primary", { modeOverrides: { theme: "dark" } });
    const child = bound("c", "var-primary");
    useSceneStore.setState({ parentById: { c: "p", p: null } });
    const { css } = buildCssForNodes(["c"], { p: parent, c: child });
    expect(css).toContain("--primary: #000000;");
  });

  it("combines Theme and Brand picks", () => {
    const node = bound("a", "var-primary", {
      modeOverrides: { theme: "dark", brand: "globex" },
      fills: [
        { id: "p1", type: "solid", color: "#1", colorBinding: { variableId: "var-primary" } },
        { id: "p2", type: "solid", color: "#2", colorBinding: { variableId: "var-accent" } },
      ],
    });
    const { css } = buildCssForNodes(["a"], { a: node });
    expect(css).toContain("--primary: #000000;");
    expect(css).toContain("--accent: #00aa00;");
  });

  it("warns and uses the first context when selected nodes differ", () => {
    const a = bound("a", "var-primary");
    const b = bound("b", "var-primary", { modeOverrides: { theme: "dark" } });
    const { css, warnings } = buildCssForNodes(["a", "b"], { a, b });
    expect(css).toContain("--primary: #ffffff;");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/different modes/);
  });

  it("follows the document mode context", () => {
    useThemeStore.getState().setCollectionMode("brand", "globex");
    const { css } = buildCssForNodes(["a"], { a: bound("a", "var-accent") });
    expect(css).toContain("--accent: #00aa00;");
  });
});

