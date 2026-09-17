import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  embedElementToSyntheticNode,
  syntheticNodeToCssDeclarations,
  diffCssDeclarations,
  applyOutlineReset,
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

  describe("background fill vs. text color (bug: text color clobbering the background)", () => {
    it("keeps node.fill as the BACKGROUND color when the element also has an explicit text color", () => {
      // happy-dom reports "" for an inherited `color` (never set explicitly),
      // which is why this needs its own inline `color:` declaration to
      // reproduce — a test relying on inheritance would pass even with the
      // bug, since `applyTextProps` would then see an empty string and never
      // overwrite `node.fill` at all.
      const target = el("background-color: rgb(255, 0, 0); color: rgb(0, 0, 255);");
      target.textContent = "hello";
      const { node } = embedElementToSyntheticNode(target);
      expect(node.fill).toBe("#ff0000");
    });

    it("has no fill at all when only a text color is set (no background)", () => {
      const target = el("color: rgb(0, 0, 255);");
      target.textContent = "hello";
      const { node } = embedElementToSyntheticNode(target);
      expect(node.fill).toBeUndefined();
    });

    it("Fill section CSS reflects the background, not the text color", () => {
      const target = el("background-color: rgb(255, 0, 0); color: rgb(0, 0, 255);");
      target.textContent = "hello";
      const { node } = embedElementToSyntheticNode(target);
      const css = syntheticNodeToCssDeclarations(node);
      expect(css["background-color"]).toBe("#ff0000");
    });

    it("captures the text color into the dedicated textFill field instead of discarding it", () => {
      const target = el("background-color: rgb(255, 0, 0); color: rgb(0, 0, 255);");
      target.textContent = "hello";
      const { node } = embedElementToSyntheticNode(target);
      expect(node.textFill).toBe("#0000ff");
      // Background stays on `fill`, unaffected by the snapshot/restore.
      expect(node.fill).toBe("#ff0000");
    });

    it("writes the text color into `color`, not `background-color`, in the CSS declaration map", () => {
      const target = el("background-color: rgb(255, 0, 0); color: rgb(0, 0, 255);");
      target.textContent = "hello";
      const { node } = embedElementToSyntheticNode(target);
      const css = syntheticNodeToCssDeclarations(node);
      expect(css.color).toBe("#0000ff");
      expect(css["background-color"]).toBe("#ff0000");
    });
  });

  describe("outline stroke reading (Align control removed)", () => {
    // `StrokeSection`'s "Align" (Inside/Center/Outside) select is hidden for
    // this bridge (`EmbedElementProperties.tsx` passes `hideAlign`) — CSS has
    // no border-alignment concept, and reconstructing it from `border`/
    // `outline`/`box-sizing` never survived an embed's own
    // `* { box-sizing: border-box }` class reset. `node.strokeAlign` is
    // therefore never populated by this bridge at all; only stroke
    // color/width visibility is preserved for an outline-only element.

    it("an outline-only element still reports a stroke (color/width), with strokeAlign left unset", () => {
      const target = el("outline: 3px solid rgb(0, 0, 0); outline-offset: 0;");
      const { node } = embedElementToSyntheticNode(target);
      expect(node.strokeWidth).toBe(3);
      expect(node.stroke).toBe("#000000");
      expect(node.strokeAlign).toBeUndefined();
    });

    it("a bordered element never gets strokeAlign populated, regardless of box-sizing", () => {
      const target = el("border: 2px solid rgb(0, 0, 0); box-sizing: border-box;");
      const { node } = embedElementToSyntheticNode(target);
      expect(node.strokeAlign).toBeUndefined();
      // The border itself (via `applyBaseProps`) still round-trips.
      expect(node.strokeWidth).toBe(2);
      expect(node.stroke).toBe("#000000");
    });

    it("no stroke at all leaves strokeAlign unset", () => {
      const target = el("width: 10px;");
      const { node } = embedElementToSyntheticNode(target);
      expect(node.strokeAlign).toBeUndefined();
    });

    it("a class-wide `box-sizing: border-box` reset has no effect on stroke reading", () => {
      // Regression guard for the bug this bridge used to have: reading
      // `strokeAlign` off the CASCADE-RESOLVED `box-sizing` (rather than the
      // element's own inline declaration) made a plain bordered element under
      // a `* { box-sizing: border-box }` class reset misreport as "Inside".
      // Now that `strokeAlign` is never computed at all, box-sizing — inline
      // or cascaded — cannot affect this bridge's output.
      const style = document.createElement("style");
      style.textContent = "* { box-sizing: border-box; }";
      document.head.appendChild(style);
      try {
        const target = el("border: 2px solid rgb(0, 0, 0);");
        expect(getComputedStyle(target).boxSizing).toBe("border-box");

        const { node } = embedElementToSyntheticNode(target);
        expect(node.strokeAlign).toBeUndefined();
        expect(node.strokeWidth).toBe(2);
      } finally {
        style.remove();
      }
    });
  });

  describe("strokeFromOutline provenance + applyOutlineReset (bug repro)", () => {
    // Bug this locks in: `applyOutlineStroke` reads an author-set `outline`
    // into `node.stroke`/`strokeWidth` without ever setting `strokeAlign`, so
    // `syntheticNodeToCssDeclarations` always renders that stroke as
    // `border` — for an outline-sourced stroke exactly as much as a
    // border-sourced one (see the describe block above). Diffing two such
    // maps can therefore never see the live `outline` to reset it on its
    // own: editing the stroke wrote a NEW `border` right next to the
    // still-live `outline` (two strokes visible), and removing the stroke
    // reset `border` to `none` while the `outline` kept painting (the
    // control looked dead, and the next re-read pulled the "removed" stroke
    // right back out of the still-live outline).

    it("an outline-only element is flagged strokeFromOutline; a bordered element is not", () => {
      const outlineNode = embedElementToSyntheticNode(el("outline: 3px solid #000000;")).node;
      expect(outlineNode.strokeFromOutline).toBe(true);

      const borderNode = embedElementToSyntheticNode(el("border: 2px solid #000000;")).node;
      expect(borderNode.strokeFromOutline).toBeUndefined();

      const strokelessNode = embedElementToSyntheticNode(el("width: 10px;")).node;
      expect(strokelessNode.strokeFromOutline).toBeUndefined();
    });

    it("a fully transparent outline is not read as a stroke at all", () => {
      // It paints nothing, so `generateVisualStyles` emits no `border` key in
      // either the before or the after map. Recording a width for it anyway
      // would make StrokeSection show a stroke row (its `hasStroke` only
      // checks `strokeWidth`) that "Remove stroke" cannot clear: the diff
      // comes back empty and the panel writes nothing at all.
      const node = embedElementToSyntheticNode(el("outline: 2px solid transparent;")).node;

      expect(node.strokeWidth).toBeUndefined();
      expect(node.stroke).toBeUndefined();
      expect(node.strokeFromOutline).toBeUndefined();
    });

    it("RED (pre-fix behavior, still true of the diff alone): recoloring an outline-sourced stroke never puts `outline` in the raw diff", () => {
      // This is the shape of the actual bug: `diffCssDeclarations` alone,
      // with no help from `applyOutlineReset`, has no way to know the
      // border it just wrote is replacing a live outline.
      const target = el("outline: 2px solid #333333;");
      const { node } = embedElementToSyntheticNode(target);
      const before = syntheticNodeToCssDeclarations(node);
      const recolored = { ...node, stroke: "#ff00ff" };
      const after = syntheticNodeToCssDeclarations(recolored);
      const patch = diffCssDeclarations(before, after);

      expect(patch.border).toBe("2px solid #ff00ff");
      expect(patch.outline).toBeUndefined();
    });

    it("GREEN: applyOutlineReset adds outline: none alongside a changed border, reusing RESET_VALUES", () => {
      const target = el("outline: 2px solid #333333;");
      const { node } = embedElementToSyntheticNode(target);
      const before = syntheticNodeToCssDeclarations(node);
      const recolored = { ...node, stroke: "#ff00ff" };
      const after = syntheticNodeToCssDeclarations(recolored);
      const patch = diffCssDeclarations(before, after);

      applyOutlineReset(node.strokeFromOutline, patch);

      expect(patch.border).toBe("2px solid #ff00ff");
      // Never both an active border AND an active outline.
      expect(patch.outline).toBe("none");
    });

    it("GREEN: removing an outline-sourced stroke resets both border and outline to none", () => {
      const target = el("outline: 2px solid #333333;");
      const { node } = embedElementToSyntheticNode(target);
      const before = syntheticNodeToCssDeclarations(node);
      const withoutStroke = { ...node, stroke: undefined, strokeWidth: undefined, strokeWidthPerSide: undefined };
      const after = syntheticNodeToCssDeclarations(withoutStroke);
      const patch = diffCssDeclarations(before, after);

      applyOutlineReset(node.strokeFromOutline, patch);

      expect(patch.border).toBe("none");
      expect(patch.outline).toBe("none");
    });

    it("is a no-op for a genuinely border-sourced stroke (RESET_VALUES['outline'] stays reachable, but only via the outline path)", () => {
      const target = el("border: 1px solid #dddddd;");
      const { node } = embedElementToSyntheticNode(target);
      const before = syntheticNodeToCssDeclarations(node);
      const recolored = { ...node, stroke: "#ff0000" };
      const after = syntheticNodeToCssDeclarations(recolored);
      const patch = diffCssDeclarations(before, after);

      applyOutlineReset(node.strokeFromOutline, patch);

      expect(patch.border).toBe("1px solid #ff0000");
      expect(patch.outline).toBeUndefined();
    });

    it("is a no-op for an edit that never touches the border (e.g. a fill-only change)", () => {
      const target = el("outline: 2px solid #333333; background-color: #ffffff;");
      const { node } = embedElementToSyntheticNode(target);
      const before = syntheticNodeToCssDeclarations(node);
      const recolored = { ...node, fill: "#000000" };
      const after = syntheticNodeToCssDeclarations(recolored);
      const patch = diffCssDeclarations(before, after);

      applyOutlineReset(node.strokeFromOutline, patch);

      expect(patch["background-color"]).toBe("#000000");
      expect(patch.outline).toBeUndefined();
      expect(patch.border).toBeUndefined();
    });

    it("a fresh re-read after the outline was reset to none no longer reports a stroke at all", () => {
      // Simulates the post-write DOM: `outline: none` inline now beats
      // whatever class/UA default was there before. `applyOutlineStroke`
      // must not resurrect a stroke from this.
      const reread = embedElementToSyntheticNode(el("outline: none; border: none;")).node;
      expect(reread.strokeFromOutline).toBeUndefined();
      expect(reread.stroke).toBeUndefined();
      expect(reread.strokeWidth).toBeUndefined();
    });
  });

  describe("flex-wrap and per-axis gap", () => {
    it("flex-wrap: wrap reads back as node.layout.flexWrap", () => {
      const target = el("display: flex; flex-wrap: wrap;");
      const { node } = embedElementToSyntheticNode(target);
      expect(node.layout?.flexWrap).toBe(true);
    });

    it("flex-wrap: nowrap (default) leaves flexWrap unset", () => {
      const target = el("display: flex;");
      const { node } = embedElementToSyntheticNode(target);
      expect(node.layout?.flexWrap).toBeUndefined();
    });

    it("distinct row-gap/column-gap longhands round-trip as separate fields", () => {
      const target = el("display: flex; row-gap: 10px; column-gap: 20px;");
      const { node } = embedElementToSyntheticNode(target);
      expect(node.layout?.rowGap).toBe(10);
      expect(node.layout?.columnGap).toBe(20);
    });

    it("gap shorthand with two differing values ('row column') is not collapsed to the first number", () => {
      const target = el("display: flex; gap: 10px 20px;");
      const { node } = embedElementToSyntheticNode(target);
      expect(node.layout?.rowGap).toBe(10);
      expect(node.layout?.columnGap).toBe(20);
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

    it("var(--x) in inline color resolves to textFillBinding, not fillBinding", () => {
      const target = el("color: var(--brand);");
      target.textContent = "hello";
      const { node } = embedElementToSyntheticNode(target, [
        { id: "var-3", name: "--brand", type: "color", value: "#00ff00" },
      ]);
      expect(node.textFillBinding).toEqual({ variableId: "var-3" });
      expect(node.fillBinding).toBeUndefined();
    });
  });
});

describe("textFillOpacity vs. background opacity (bug repro)", () => {
  it("does not inherit the background's alpha when the text color is fully opaque", () => {
    const target = el("background-color: rgba(255, 0, 0, 0.5); color: rgb(0, 0, 0);");
    target.textContent = "hi";
    const { node } = embedElementToSyntheticNode(target);
    // Background alpha is preserved on the BACKGROUND fields...
    expect(node.fillOpacity).toBe(0.5);
    // ...and must not leak onto the (fully opaque) text color.
    expect(node.textFillOpacity).toBeUndefined();
  });

  it("emits a fully opaque `color` declaration, not the background's rgba alpha", () => {
    const target = el("background-color: rgba(255, 0, 0, 0.5); color: rgb(0, 0, 0);");
    target.textContent = "hi";
    const { node } = embedElementToSyntheticNode(target);
    const css = syntheticNodeToCssDeclarations(node);
    expect(css.color).toBe("#000000");
  });
});

describe("box-sizing is never emitted by this bridge (Align control removed)", () => {
  // Since nothing in this bridge ever sets `node.strokeAlign` to `"inside"`
  // (the only value `generateVisualStyles` turns into a `box-sizing`
  // declaration), `box-sizing` can never appear in a `syntheticNodeToCssDeclarations`
  // map, so there is nothing for `diffCssDeclarations` to diff or reset for
  // it — no inline `box-sizing` write is possible from this panel at all,
  // which is exactly the property this test locks in (this used to be the
  // source of the box-sizing/Align round-trip bugs).

  it("a bordered element's CSS declaration map never includes box-sizing", () => {
    const target = el("border: 1px solid #dddddd; box-sizing: border-box;");
    const { node } = embedElementToSyntheticNode(target);
    const css = syntheticNodeToCssDeclarations(node);
    expect(css["box-sizing"]).toBeUndefined();
  });

  it("removing a stroke entirely never touches box-sizing in the diff", () => {
    const target = el("border: 1px solid #dddddd; box-sizing: border-box;");
    const { node } = embedElementToSyntheticNode(target);
    const before = syntheticNodeToCssDeclarations(node);

    const withoutStroke: typeof node = {
      ...node,
      stroke: undefined,
      strokeWidth: undefined,
      strokeWidthPerSide: undefined,
    };
    const after = syntheticNodeToCssDeclarations(withoutStroke);

    const patch = diffCssDeclarations(before, after);
    expect(patch["box-sizing"]).toBeUndefined();
  });

  it("editing stroke color/width alone never introduces a box-sizing declaration", () => {
    const target = el("border: 1px solid #dddddd;");
    const { node } = embedElementToSyntheticNode(target);
    const before = syntheticNodeToCssDeclarations(node);

    const recolored: typeof node = { ...node, stroke: "#ff0000", strokeWidth: 4 };
    const after = syntheticNodeToCssDeclarations(recolored);
    const patch = diffCssDeclarations(before, after);

    expect(patch.border).toBe("4px solid #ff0000");
    expect(patch["box-sizing"]).toBeUndefined();
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

  it("padding survives turning auto-layout off (bug: RESET_VALUES zeroed it)", () => {
    // Mirrors `AutoLayoutSection`'s `disableAutoLayout`, which spreads
    // `...node.layout` and only flips `autoLayout: false` — padding stays on
    // the layout object even though the frame is no longer a flex container.
    const target = el("display: flex; padding: 16px;");
    const { node } = embedElementToSyntheticNode(target);
    expect(node.layout?.paddingTop).toBe(16);

    const disabled = { ...node, layout: { ...node.layout, autoLayout: false } };
    const css = syntheticNodeToCssDeclarations(disabled);
    // Before the fix, `generateLayoutStyles` only emits `padding` inside its
    // `autoLayout` branch, so this key vanished entirely and
    // `diffCssDeclarations` would have written back an explicit
    // `padding: 0px` reset the moment auto-layout was turned off.
    expect(css.padding).toBe("16px");
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

  it("emits `color` only when the node has text (typography-only gate)", () => {
    const withText = el("color: rgb(0, 0, 255);");
    withText.textContent = "hi";
    const { node: textNode } = embedElementToSyntheticNode(withText);
    expect(syntheticNodeToCssDeclarations(textNode).color).toBe("#0000ff");

    const withoutText = el("color: rgb(0, 0, 255);", "<span>x</span>");
    const { node: nonTextNode } = embedElementToSyntheticNode(withoutText);
    expect(syntheticNodeToCssDeclarations(nonTextNode).color).toBeUndefined();
  });

  it("round-trips a text-color variable binding back into var(--x, fallback)", () => {
    useVariableStore.setState({
      variables: [{ id: "var-3", name: "--brand", type: "color", value: "#00ff00" }],
    });
    const target = el("color: var(--brand);");
    target.textContent = "hi";
    const { node } = embedElementToSyntheticNode(target, [
      { id: "var-3", name: "--brand", type: "color", value: "#00ff00" },
    ]);
    // Same happy-dom limitation as the background-binding test above: seed
    // the resolved fallback directly onto the dedicated text-color field.
    node.textFill = "#00ff00";
    const css = syntheticNodeToCssDeclarations(node);
    expect(css.color).toBe("var(--brand, #00ff00)");
  });

  it("unbinding the text color writes the resolved literal, not var(...)", () => {
    // `node.textFill` is always the CURRENTLY RESOLVED computed-style value
    // (getComputedStyle resolves `var()` against whichever theme's custom
    // properties are in scope), so clearing `textFillBinding` alone — with
    // no other change — is enough to fall back to a plain literal that
    // already reflects the effective theme, the same mechanism the
    // background/`fillBinding` round trip already relies on.
    useVariableStore.setState({
      variables: [{ id: "var-3", name: "--brand", type: "color", value: "#00ff00" }],
    });
    const target = el("color: var(--brand);");
    target.textContent = "hi";
    const { node } = embedElementToSyntheticNode(target, [
      { id: "var-3", name: "--brand", type: "color", value: "#00ff00" },
    ]);
    node.textFill = "#00ff00";
    const bound = syntheticNodeToCssDeclarations(node);
    expect(bound.color).toBe("var(--brand, #00ff00)");

    const unbound = syntheticNodeToCssDeclarations({ ...node, textFillBinding: undefined });
    expect(unbound.color).toBe("#00ff00");

    const patch = diffCssDeclarations(bound, unbound);
    expect(patch.color).toBe("#00ff00");
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
