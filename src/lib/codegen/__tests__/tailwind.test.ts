import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedVariables } from "@/test/fixtures";
import { buildTailwindCode, declarationsToTailwind } from "../tailwind";
import type { FlatFrameNode, RectNode, TextNode } from "@/types/scene";

describe("declarationsToTailwind", () => {
  beforeEach(() => {
    resetStores();
  });

  it("(a) maps values that match the standard Tailwind scale", () => {
    const classes = declarationsToTailwind(
      {
        width: "16px",
        "font-size": "16px",
        "font-weight": "700",
        opacity: "0.5",
        display: "flex",
        "flex-direction": "column",
        "flex-wrap": "wrap",
        "align-items": "center",
        "justify-content": "space-between",
        "border-radius": "8px",
      },
      { units: "px", remBase: 16 },
    );

    expect(classes).toContain("w-4");
    expect(classes).toContain("text-base");
    expect(classes).toContain("font-bold");
    expect(classes).toContain("opacity-50");
    expect(classes).toContain("flex");
    expect(classes).toContain("flex-col");
    expect(classes).toContain("flex-wrap");
    expect(classes).toContain("items-center");
    expect(classes).toContain("justify-between");
    expect(classes).toContain("rounded-lg");
  });

  it("(b) falls back to arbitrary values for anything off-scale", () => {
    const classes = declarationsToTailwind(
      {
        width: "347px",
        "background-color": "#8b5cf6",
        "box-shadow": "0px 4px 8px 0px rgba(0,0,0,0.25)",
      },
      { units: "px", remBase: 16 },
    );

    expect(classes).toContain("w-[347px]");
    expect(classes).toContain("bg-[#8b5cf6]");
    expect(classes).toContain("shadow-[0px_4px_8px_0px_rgba(0,0,0,0.25)]");
  });

  it("(c) collapses var(--token, fallback) to bg-[var(--token)]", () => {
    const classes = declarationsToTailwind(
      { "background-color": "var(--primary, #3366ff)" },
      { units: "px", remBase: 16 },
    );

    expect(classes).toContain("bg-[var(--primary)]");
  });

  it("(d) converts arbitrary-value lengths to rem, but leaves scale classes alone", () => {
    const classes = declarationsToTailwind(
      { width: "347px", height: "16px" },
      { units: "rem", remBase: 16 },
    );

    expect(classes).toContain("w-[21.6875rem]");
    // 16px is a standard scale hit (16/4=4) -- unaffected by the rem option.
    expect(classes).toContain("h-4");
  });

  it("keeps unmappable composite declarations as arbitrary properties", () => {
    const classes = declarationsToTailwind(
      { transform: "rotate(45deg) scale(-1, 1)" },
      { units: "px", remBase: 16 },
    );

    expect(classes).toEqual(["[transform:rotate(45deg)_scale(-1,_1)]"]);
  });
});

function frameNode(overrides: Partial<FlatFrameNode> = {}): FlatFrameNode {
  return {
    id: "frame1",
    type: "frame",
    name: "Card */ <script>alert(1)</script>",
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
    text: "Card */ <script>alert(1)</script>",
    fontSize: 16,
    fontWeight: "700",
  } as unknown as TextNode;
}

function boxRect(): RectNode {
  return {
    id: "rect1",
    type: "rect",
    name: "Box",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    cornerRadius: 8,
    fill: "#ff0000",
  } as unknown as RectNode;
}

describe("buildTailwindCode", () => {
  beforeEach(() => {
    resetStores();
  });

  it("(e) emits only the class string for a leaf node (no HTML wrapper)", () => {
    const node = boxRect();
    const { code, warnings } = buildTailwindCode("rect1", { rect1: node }, {}, { units: "px", remBase: 16 });

    expect(warnings).toEqual([]);
    expect(code).not.toContain("<div");
    expect(code).toContain("w-25");
    expect(code).toContain("h-10");
    expect(code).toContain("rounded-lg");
    expect(code).toContain("bg-[#ff0000]");
  });

  it("(f) emits indented HTML markup for a frame with a text child, escaping untrusted text", () => {
    const frame = frameNode();
    const text = titleText();
    const rect = boxRect();
    const nodesById = { frame1: frame, text1: text, rect1: rect };
    const childrenById = { frame1: ["text1", "rect1"] };

    const { code, warnings } = buildTailwindCode("frame1", nodesById, childrenById, { units: "px", remBase: 16 });

    expect(warnings).toEqual([]);
    expect(code).toMatchSnapshot();

    // Root frame: auto-layout column, gap 8 -> gap-2, padding 16 -> p-4, 300x200 -> w-75 h-50.
    expect(code).toContain('<div class="box-border flex flex-col gap-2 p-4 w-75 h-50">');
    // Text child renders as an indented div holding the escaped text content.
    expect(code).toContain(
      '  <div class="box-border shrink-0 w-30 h-6 text-base font-bold">Card */ &lt;script&gt;alert(1)&lt;/script&gt;</div>',
    );
    // Rect child renders as an indented div with no text content.
    expect(code).toContain('  <div class="box-border shrink-0 w-25 h-10 bg-[#ff0000] rounded-lg"></div>');
    // Untrusted node name never appears verbatim (it isn't echoed at all).
    expect(code).not.toContain("<script>alert(1)</script>");
  });

  it("reports a warning and returns empty code for a missing root node", () => {
    const { code, warnings } = buildTailwindCode("missing", {}, {}, { units: "px", remBase: 16 });
    expect(warnings).toEqual(["Node not found: missing"]);
    expect(code).toBe("");
  });

  it("emits var(--token) classes and applies rem conversion inside a frame subtree", () => {
    seedVariables();
    const frame = frameNode({
      width: 100,
      height: 100,
      layout: undefined,
      fills: [
        {
          id: "p1",
          type: "solid",
          color: "#3366ff",
          colorBinding: { variableId: "var-primary" },
        },
      ],
    } as unknown as Partial<FlatFrameNode>);
    const rect = boxRect();
    const nodesById = { frame1: frame, rect1: rect };
    const childrenById = { frame1: ["rect1"] };

    const { code } = buildTailwindCode("frame1", nodesById, childrenById, { units: "rem", remBase: 16 });

    expect(code).toContain("bg-[var(--primary)]");
    // Root frame is 100x100 -> scale hit (w-25 h-25), unaffected by rem mode.
    expect(code).toContain("w-25");
    expect(code).toContain("h-25");
  });

  it("prepends a ready-to-paste :root{} definitions block when the subtree binds a variable", () => {
    seedVariables();
    const frame = frameNode({
      width: 100,
      height: 100,
      layout: undefined,
      fills: [
        {
          id: "p1",
          type: "solid",
          color: "#3366ff",
          colorBinding: { variableId: "var-primary" },
        },
      ],
    } as unknown as Partial<FlatFrameNode>);
    const rect = boxRect();
    const nodesById = { frame1: frame, rect1: rect };
    const childrenById = { frame1: ["rect1"] };

    const { code } = buildTailwindCode("frame1", nodesById, childrenById, { units: "px", remBase: 16 });

    expect(code).toContain(":root {");
    expect(code).toContain("--primary: #3366ff;");
    // The definitions block comes before the markup.
    expect(code.indexOf(":root {")).toBeLessThan(code.indexOf("<div"));
  });

  it("warns and adds a needed-tokens list for a bound-variable leaf (no markup wrapper)", () => {
    seedVariables();
    const rect = {
      ...boxRect(),
      fill: undefined,
      fills: [
        {
          id: "p1",
          type: "solid",
          color: "#3366ff",
          colorBinding: { variableId: "var-primary" },
        },
      ],
    } as unknown as RectNode;

    const { code, warnings } = buildTailwindCode("rect1", { rect1: rect }, {}, { units: "px", remBase: 16 });

    expect(code).toContain("bg-[var(--primary)]");
    expect(warnings.some((w) => w.includes("--primary"))).toBe(true);
  });

  it("warns once for an unsupported node type (ref) rendered as an empty placeholder", () => {
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

    const { code, warnings } = buildTailwindCode("frame1", nodesById, childrenById, { units: "px", remBase: 16 });

    expect(code).toContain("<div");
    expect(warnings.some((w) => w.includes("instance") || w.includes("Instance"))).toBe(true);
  });
});
