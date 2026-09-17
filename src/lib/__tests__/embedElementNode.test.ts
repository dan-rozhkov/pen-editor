import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  embedElementToSyntheticNode,
  syntheticNodeToCssDeclarations,
  diffCssDeclarations,
  SYNTHETIC_EMBED_ELEMENT_ID,
} from "../embedElementNode";
import { useVariableStore } from "@/store/variableStore";
import type { FrameNode, TextNode } from "@/types/scene";

function el(style: string, html = ""): HTMLElement {
  const div = document.createElement("div");
  div.setAttribute("style", style);
  if (html) div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

beforeEach(() => {
  useVariableStore.setState({ variables: [] });
});

describe("embedElementToSyntheticNode", () => {
  it("never collides with a real scene-graph id", () => {
    const { node } = embedElementToSyntheticNode(el("width: 10px; height: 10px;"));
    expect(node.id).toBe(SYNTHETIC_EMBED_ELEMENT_ID);
    expect(node.id).not.toMatch(/^[a-z0-9]{8,}$/); // not nanoid-shaped
  });

  it("is always a frame node", () => {
    const { node } = embedElementToSyntheticNode(el("width: 10px;"));
    expect(node.type).toBe("frame");
  });

  describe("size: offsetWidth/offsetHeight, not getBoundingClientRect", () => {
    it("uses the offset box (layout px) even when the client rect is scaled (zoom)", () => {
      const target = el("width: 100px; height: 100px;");
      Object.defineProperty(target, "offsetWidth", { value: 100, configurable: true });
      Object.defineProperty(target, "offsetHeight", { value: 100, configurable: true });
      vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
        width: 200,
        height: 200,
        top: 0,
        left: 0,
        right: 200,
        bottom: 200,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      } as DOMRect);

      const { node } = embedElementToSyntheticNode(target);
      // A naive getBoundingClientRect()-based implementation would report
      // 200 here (the post-transform screen size at 200% zoom); the offset
      // box is the untransformed layout size and is what must round-trip.
      expect(node.width).toBe(100);
      expect(node.height).toBe(100);
    });

    it("falls back to computed width/height when the offset box is zero (no layout engine)", () => {
      const target = el("width: 64px; height: 48px;");
      const { node } = embedElementToSyntheticNode(target);
      expect(node.width).toBe(64);
      expect(node.height).toBe(48);
    });
  });

  describe("flex layout → node.layout", () => {
    it("flex element gets autoLayout with matching fields", () => {
      const target = el(
        "display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: space-between; padding: 4px 8px 12px 16px;",
      );
      const { node } = embedElementToSyntheticNode(target);
      expect(node.layout).toEqual({
        autoLayout: true,
        flexDirection: "column",
        gap: 12,
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 4,
        paddingRight: 8,
        paddingBottom: 12,
        paddingLeft: 16,
      });
    });

    it("non-flex element gets no layout field at all", () => {
      const target = el("display: block; padding: 10px;");
      const { node } = embedElementToSyntheticNode(target);
      expect(node.layout).toBeUndefined();
    });

    it("inline-flex also counts as flex", () => {
      const target = el("display: inline-flex; flex-direction: row;");
      const { node } = embedElementToSyntheticNode(target);
      expect(node.layout?.autoLayout).toBe(true);
      expect(node.layout?.flexDirection).toBe("row");
    });
  });

  describe("text content", () => {
    it("childless element with text reports hasText and node.text", () => {
      const target = el("", "");
      target.textContent = "hello world";
      const { node, hasText } = embedElementToSyntheticNode(target);
      expect(hasText).toBe(true);
      expect(node.text).toBe("hello world");
    });

    it("element with child elements reports hasText: false and no node.text", () => {
      const target = el("", "<span>icon</span>label");
      const { node, hasText } = embedElementToSyntheticNode(target);
      expect(hasText).toBe(false);
      expect(node.text).toBeUndefined();
    });

    it("typography fields are populated even when hasText is false", () => {
      const target = el("font-size: 20px; font-weight: 700;", "<span>icon</span>label");
      const { node, hasText } = embedElementToSyntheticNode(target);
      expect(hasText).toBe(false);
      expect(node.fontSize).toBe(20);
      expect(node.fontWeight).toBe("700");
    });
  });

  describe("variable bindings", () => {
    it("var(--x) in inline background-color resolves to fillBinding", () => {
      const target = el("background-color: var(--primary);");
      const { node } = embedElementToSyntheticNode(target, [
        { id: "var-1", name: "--primary", type: "color", value: "#3366ff" },
      ]);
      expect(node.fillBinding).toEqual({ variableId: "var-1" });
    });

    it("var(--x) in inline border-color resolves to strokeBinding", () => {
      const target = el("border: 2px solid var(--line);");
      const { node } = embedElementToSyntheticNode(target, [
        { id: "var-2", name: "--line", type: "color", value: "#000000" },
      ]);
      expect(node.strokeBinding).toEqual({ variableId: "var-2" });
    });

    it("unresolvable variable name (not in the provided list) leaves no binding", () => {
      const target = el("background-color: var(--unknown);");
      const { node } = embedElementToSyntheticNode(target, [
        { id: "var-1", name: "--primary", type: "color", value: "#3366ff" },
      ]);
      expect(node.fillBinding).toBeUndefined();
    });

    it("a resolved (non-var) color never produces a binding", () => {
      const target = el("background-color: #ff0000;");
      const { node } = embedElementToSyntheticNode(target, [
        { id: "var-1", name: "--primary", type: "color", value: "#3366ff" },
      ]);
      expect(node.fillBinding).toBeUndefined();
    });
  });
});

describe("syntheticNodeToCssDeclarations", () => {
  it("round-trips simple visual styles", () => {
    const target = el(
      "background-color: rgb(255, 0, 0); border-radius: 8px; opacity: 0.5;",
    );
    const { node } = embedElementToSyntheticNode(target);
    const css = syntheticNodeToCssDeclarations(node);
    expect(css["background-color"]).toBe("#ff0000");
    expect(css["border-radius"]).toBe("8px");
    expect(css.opacity).toBe("0.5");
  });

  it("round-trips flex layout styles", () => {
    const target = el(
      "display: flex; flex-direction: row; gap: 10px; align-items: center; justify-content: flex-start; padding: 5px;",
    );
    const { node } = embedElementToSyntheticNode(target);
    const css = syntheticNodeToCssDeclarations(node);
    expect(css.display).toBe("flex");
    expect(css["flex-direction"]).toBe("row");
    expect(css.gap).toBe("10px");
    expect(css["align-items"]).toBe("center");
    expect(css["justify-content"]).toBe("flex-start");
    expect(css.padding).toBe("5px");
  });

  it("filters out box-sizing/position/width/height from the layout generator", () => {
    const target = el("display: block;");
    const { node } = embedElementToSyntheticNode(target);
    const css = syntheticNodeToCssDeclarations(node);
    expect(css["box-sizing"]).toBeUndefined();
    expect(css.position).toBeUndefined();
    expect(css.width).toBeUndefined();
    expect(css.height).toBeUndefined();
  });

  it("emits typography styles only when the node has text", () => {
    const withText = el("font-size: 18px;");
    withText.textContent = "hi";
    const { node: textNode } = embedElementToSyntheticNode(withText);
    expect(syntheticNodeToCssDeclarations(textNode)["font-size"]).toBe("18px");

    const withoutText = el("font-size: 18px;", "<span>x</span>");
    const { node: nonTextNode } = embedElementToSyntheticNode(withoutText);
    expect(syntheticNodeToCssDeclarations(nonTextNode)["font-size"]).toBeUndefined();
  });

  it("round-trips a variable binding back into var(--x, fallback)", () => {
    useVariableStore.setState({
      variables: [{ id: "var-1", name: "--primary", type: "color", value: "#3366ff" }],
    });
    const target = el("background-color: var(--primary);");
    // getComputedStyle resolves var() to nothing in happy-dom (no custom
    // property registered), so seed the fallback color directly on the node
    // the way the real browser's resolved background-color would.
    const { node } = embedElementToSyntheticNode(target, [
      { id: "var-1", name: "--primary", type: "color", value: "#3366ff" },
    ]);
    node.fill = "#3366ff";
    const css = syntheticNodeToCssDeclarations(node);
    expect(css["background-color"]).toBe("var(--primary, #3366ff)");
  });
});

describe("diffCssDeclarations", () => {
  it("changed value → written as-is", () => {
    const patch = diffCssDeclarations({ opacity: "1" }, { opacity: "0.5" });
    expect(patch).toEqual({ opacity: "0.5" });
  });

  it("unchanged value → omitted", () => {
    const patch = diffCssDeclarations({ opacity: "0.5" }, { opacity: "0.5" });
    expect(patch).toEqual({});
  });

  it("new key (absent before, present after) → written as-is", () => {
    const patch = diffCssDeclarations({}, { "border-radius": "8px" });
    expect(patch).toEqual({ "border-radius": "8px" });
  });

  it("key absent in both → omitted entirely", () => {
    const patch = diffCssDeclarations({ opacity: "1" }, { opacity: "1" });
    expect(patch["box-shadow"]).toBeUndefined();
    expect("box-shadow" in patch).toBe(false);
  });

  // One assertion per reset-table entry: every property this bridge can
  // ever emit must get an EXPLICIT reset when it disappears, never a bare
  // `null` (removeProperty) — see the module's doc comment for why a plain
  // removal would silently no-op against a class-styled embed element.
  const RESET_CASES: Array<[key: string, before: string]> = [
    ["background-color", "#ff0000"],
    ["background-image", "url(x.png)"],
    ["background-size", "cover"],
    ["background-position", "10px 10px"],
    ["background-repeat", "no-repeat"],
    ["background-blend-mode", "multiply"],
    ["color", "#000000"],
    ["border", "1px solid #000"],
    ["border-top", "1px solid #000"],
    ["border-right", "1px solid #000"],
    ["border-bottom", "1px solid #000"],
    ["border-left", "1px solid #000"],
    ["outline", "1px solid #000"],
    ["border-image-source", "linear-gradient(red, blue)"],
    ["border-image-slice", "1"],
    ["box-sizing", "border-box"],
    ["border-radius", "8px"],
    ["opacity", "0.5"],
    ["box-shadow", "0px 4px 6px 0px #000000"],
    ["filter", "blur(4px)"],
    ["backdrop-filter", "blur(4px)"],
    ["-webkit-backdrop-filter", "blur(4px)"],
    ["transform", "rotate(10deg)"],
    ["font-size", "20px"],
    ["font-family", "'Inter'"],
    ["font-weight", "700"],
    ["font-style", "italic"],
    ["font-variation-settings", "'wght' 500"],
    ["font-feature-settings", "'liga' 1"],
    ["text-align", "center"],
    ["line-height", "1.5"],
    ["letter-spacing", "2px"],
    ["text-decoration", "underline"],
    ["text-transform", "uppercase"],
    ["white-space", "nowrap"],
    ["align-content", "center"],
    ["display", "flex"],
    ["flex-direction", "column"],
    ["flex-wrap", "wrap"],
    ["gap", "12px"],
    ["row-gap", "8px"],
    ["column-gap", "8px"],
    ["align-items", "center"],
    ["justify-content", "space-between"],
    ["padding", "16px"],
  ];

  it.each(RESET_CASES)(
    "%s: disappearing from `after` writes an explicit non-null reset, never removeProperty",
    (key, before) => {
      const patch = diffCssDeclarations({ [key]: before }, {});
      expect(patch[key]).not.toBeNull();
      expect(typeof patch[key]).toBe("string");
      // The reset must actually differ from the prior value in every case
      // exercised here, or the assertion would be vacuous.
      expect(patch[key]).not.toBe(before);
    },
  );

  it("removeInsteadOfReset opts a specific property into null (Remove fill)", () => {
    const patch = diffCssDeclarations(
      { "background-color": "#ff0000" },
      {},
      { removeInsteadOfReset: ["background-color"] },
    );
    expect(patch["background-color"]).toBeNull();
  });

  it("removeInsteadOfReset does not affect other properties in the same diff", () => {
    const patch = diffCssDeclarations(
      { "background-color": "#ff0000", opacity: "0.5" },
      {},
      { removeInsteadOfReset: ["background-color"] },
    );
    expect(patch["background-color"]).toBeNull();
    expect(patch.opacity).toBe("1");
  });

  it("changing border color only rewrites the single composed border declaration, never touching width via a separate longhand", () => {
    // Simulates: native StrokeSection changes only the color. Because
    // generateVisualStyles always emits ONE composed `border` shorthand
    // carrying the CURRENT width, the diff produces a single full
    // replacement value — there is no `border-width`/`border-color` split
    // to accidentally null out.
    const before = { border: "2px solid #111111" };
    const after = { border: "2px solid #222222" };
    const patch = diffCssDeclarations(before, after);
    expect(patch).toEqual({ border: "2px solid #222222" });
    expect(patch["border-width"]).toBeUndefined();
    expect(patch["border-color"]).toBeUndefined();
  });
});

describe("round trip: element → node → CSS ≈ original declarations", () => {
  it("visual + layout properties survive the round trip", () => {
    const target = el(
      [
        "background-color: rgb(0, 128, 255)",
        "border-radius: 4px",
        "opacity: 0.75",
        "display: flex",
        "flex-direction: row",
        "gap: 6px",
        "padding: 2px 4px 6px 8px",
      ].join("; "),
    );
    const { node } = embedElementToSyntheticNode(target);
    const css = syntheticNodeToCssDeclarations(node);

    expect(css["background-color"]).toBe("#0080ff");
    expect(css["border-radius"]).toBe("4px");
    expect(css.opacity).toBe("0.75");
    expect(css.display).toBe("flex");
    expect(css["flex-direction"]).toBe("row");
    expect(css.gap).toBe("6px");
    expect(css.padding).toBe("2px 4px 6px 8px");
  });
});

// Sanity: the exported node shape is usable where a FrameNode/TextNode is
// expected (compile-time check + a couple of runtime field spot-checks).
describe("SyntheticEmbedElementNode shape", () => {
  it("is assignable as a FrameNode", () => {
    const target = el("width: 10px; height: 10px;");
    const { node } = embedElementToSyntheticNode(target);
    const asFrame: FrameNode = node;
    expect(asFrame.type).toBe("frame");
  });

  it("casts to TextNode for typography-only reads", () => {
    const target = el("font-size: 14px;");
    target.textContent = "hi";
    const { node } = embedElementToSyntheticNode(target);
    const asText = node as unknown as TextNode;
    expect(asText.fontSize).toBe(14);
    expect(asText.text).toBe("hi");
  });
});
