import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedVariables } from "@/test/fixtures";
import { buildReactCode } from "../react";
import type { FlatFrameNode, RectNode, TextNode } from "@/types/scene";

function frameNode(overrides: Partial<FlatFrameNode> = {}): FlatFrameNode {
  return {
    id: "frame1",
    type: "frame",
    name: "Card",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    layout: {
      autoLayout: true,
      flexDirection: "column",
      gap: 8,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    },
    ...overrides,
  } as unknown as FlatFrameNode;
}

function titleText(): TextNode {
  return {
    id: "text1",
    type: "text",
    name: "Title",
    x: 0,
    y: 0,
    width: 120,
    height: 24,
    text: "Hello & <world>",
    fontSize: 16,
    fontWeight: "700",
  } as unknown as TextNode;
}

function avatarImage(): RectNode {
  return {
    id: "img1",
    type: "rect",
    name: "Avatar",
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    cornerRadius: 20,
    fills: [
      {
        id: "p1",
        type: "image",
        image: { url: "https://example.com/a.png", mode: "fill" },
      },
    ],
  } as unknown as RectNode;
}

async function assertCompiles(code: string): Promise<void> {
  const ts = await import("typescript");
  const result = ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  const syntaxErrors = (result.diagnostics ?? []).filter((d) => d.category === 1 /* Error */);
  expect(syntaxErrors, JSON.stringify(syntaxErrors.map((d) => d.messageText))).toEqual([]);
}

describe("buildReactCode", () => {
  beforeEach(() => {
    resetStores();
  });

  it("(a) generates an inline-style component for a frame with rect/text/image-fill children", async () => {
    const frame = frameNode();
    const text = titleText();
    const image = avatarImage();
    const nodesById = { frame1: frame, text1: text, img1: image };
    const childrenById = { frame1: ["text1", "img1"] };

    const { code, warnings } = buildReactCode("frame1", nodesById, childrenById, {
      units: "px",
      remBase: 16,
      styleMode: "inline",
    });

    expect(warnings).toEqual([]);
    expect(code).toMatchSnapshot();
    expect(code).toContain("export function Card() {");
    expect(code).toContain('style={{ boxSizing: "border-box"');
    // Text content is escaped via a JS string expression, never raw JSX children
    // (the angle brackets are safely inside the quoted string, not live JSX).
    expect(code).toContain('{"Hello & <world>"}');
    // Image-fill child becomes an <img> placeholder with alt = node name.
    expect(code).toContain('<img src=""');
    expect(code).toContain('alt={"Avatar"}');
    // Named text child gets a comment (its name "Title" isn't the Figma default "Text").
    expect(code).toContain("{/* Title */}");
    await assertCompiles(code);
  });

  it("(b) generates a Tailwind-className component for the same tree", async () => {
    const frame = frameNode();
    const text = titleText();
    const image = avatarImage();
    const nodesById = { frame1: frame, text1: text, img1: image };
    const childrenById = { frame1: ["text1", "img1"] };

    const { code, warnings } = buildReactCode("frame1", nodesById, childrenById, {
      units: "px",
      remBase: 16,
      styleMode: "tailwind",
    });

    expect(warnings).toEqual([]);
    expect(code).toMatchSnapshot();
    expect(code).toContain('className={"box-border flex flex-col gap-2 p-4 w-75 h-50"}');
    expect(code).toContain('<img src=""');
    await assertCompiles(code);
  });

  it("(c) sanitizes a hostile node name (component name, comment, and alt text) into valid, parseable JSX", async () => {
    const hostileName = "Card */ }} <evil>";
    const frame = frameNode({ name: hostileName });
    const child = avatarImage();
    (child as unknown as { name: string }).name = hostileName;
    const nodesById = { frame1: frame, img1: child };
    const childrenById = { frame1: ["img1"] };

    const { code, warnings } = buildReactCode("frame1", nodesById, childrenById, {
      units: "px",
      remBase: 16,
      styleMode: "inline",
    });

    expect(warnings).toEqual([]);
    // The comment's "*/" is neutralized (zero-width space inserted) so it can't
    // close the block comment early; compiling below is the real proof.
    expect(code).toContain("Card *​/ }} <evil>");
    // Component name is a valid JS identifier regardless of the hostile input.
    expect(code).toMatch(/^export function [A-Z][A-Za-z0-9]*\(\)/m);
    await assertCompiles(code);
  });

  it("(d) falls back to '<Type>Component' when the root name sanitizes to nothing usable", async () => {
    const frame = frameNode({ name: "!!! ---" });
    const { code } = buildReactCode("frame1", { frame1: frame }, {}, { units: "px", remBase: 16, styleMode: "inline" });

    expect(code).toContain("export function FrameComponent() {");
  });

  it("(e) reports a warning and returns empty code for a missing root node", () => {
    const { code, warnings } = buildReactCode("missing", {}, {}, { units: "px", remBase: 16, styleMode: "inline" });
    expect(warnings).toEqual(["Node not found: missing"]);
    expect(code).toBe("");
  });

  it("(f) converts px lengths to rem in inline style values", async () => {
    const frame = frameNode({ layout: undefined, width: 100, height: 100 });
    const { code } = buildReactCode("frame1", { frame1: frame }, {}, { units: "rem", remBase: 16, styleMode: "inline" });

    expect(code).toContain('"6.25rem"');
    await assertCompiles(code);
  });

  it("(g) renders a childless leaf node as a self-closing element", async () => {
    const rect: RectNode = {
      id: "rect1",
      type: "rect",
      name: "Box",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      fill: "#ff0000",
    } as unknown as RectNode;

    const { code } = buildReactCode("rect1", { rect1: rect }, {}, { units: "px", remBase: 16, styleMode: "tailwind" });

    expect(code).toContain("/>");
    expect(code).not.toContain("></div>");
    await assertCompiles(code);
  });

  it("(h) a pattern fill's URL containing a quote can't break out of the className attribute (tailwind styleMode)", async () => {
    const rect: RectNode = {
      id: "rect1",
      type: "rect",
      name: "Box",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      fills: [
        {
          id: "p1",
          type: "pattern",
          pattern: { url: 'https://evil.example/a.png") } <script>alert(1)</script' },
        },
      ],
    } as unknown as RectNode;

    const { code } = buildReactCode("rect1", { rect1: rect }, {}, { units: "px", remBase: 16, styleMode: "tailwind" });

    // The value is a JS string expression, never interpolated into a `"..."` attribute.
    expect(code).toContain("className={");
    expect(code).not.toContain('className="');
    expect(code).not.toContain("<script>alert(1)</script>");
    await assertCompiles(code);
  });

  it("(i) warns once for an unsupported node type (ref) rendered as an empty placeholder", () => {
    const frame = frameNode({ layout: undefined });
    const ref = {
      id: "ref1",
      type: "ref",
      name: "Button",
      x: 0,
      y: 0,
      width: 50,
      height: 20,
      componentId: "comp1",
      overrides: {},
      propertyValues: {},
    } as unknown as RectNode;
    const nodesById = { frame1: frame, ref1: ref };
    const childrenById = { frame1: ["ref1"] };

    const { code, warnings } = buildReactCode("frame1", nodesById, childrenById, {
      units: "px",
      remBase: 16,
      styleMode: "inline",
    });

    expect(code).toContain("<div");
    expect(warnings.some((w) => w.toLowerCase().includes("instance"))).toBe(true);
  });

  it("(j) prepends a CSS-variable-definitions block comment when the subtree binds a variable", async () => {
    seedVariables();
    const frame = frameNode({
      layout: undefined,
      width: 100,
      height: 100,
      fills: [
        {
          id: "p1",
          type: "solid",
          color: "#3366ff",
          colorBinding: { variableId: "var-primary" },
        },
      ],
    } as unknown as Partial<FlatFrameNode>);

    const { code } = buildReactCode("frame1", { frame1: frame }, {}, { units: "px", remBase: 16, styleMode: "inline" });

    expect(code).toContain("/* Requires CSS variables:");
    expect(code).toContain(":root {");
    expect(code).toContain("--primary: #3366ff;");
    expect(code.indexOf(":root {")).toBeLessThan(code.indexOf("export function"));
    await assertCompiles(code);
  });
});
