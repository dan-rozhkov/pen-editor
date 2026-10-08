import { describe, expect, it } from "vitest";
import { assertDefined } from "@/test/assertions";
import { byRule, frame, lint, rect, solid, text, token } from "./fixtures";

const contrastOf = (r: ReturnType<typeof lint>) => byRule(r, "contrast");

describe("native contrast", () => {
  it("passes black on the white page and fails #777 (4.48:1) as an error", () => {
    expect(contrastOf(lint([text("t", { fill: "#000000" })]))).toHaveLength(0);
    const [f] = contrastOf(lint([text("t", { fill: "#777777", name: "Caption" })]));
    assertDefined(f);
    expect(f.severity).toBe("error");
    expect(f.message).toContain("4.48:1");
    expect(f.message).toContain("needs 4.5:1");
    expect(contrastOf(lint([text("t", { fill: "#767676" })]))).toHaveLength(0);
  });

  it("uses the 3:1 bar for large text", () => {
    expect(contrastOf(lint([text("t", { fill: "#777777", fontSize: 24 })]))).toHaveLength(0);
    expect(contrastOf(lint([text("t", { fill: "#777777", fontSize: 19, fontWeight: "700" })]))).toHaveLength(0);
    expect(contrastOf(lint([text("t", { fill: "#777777", fontSize: 19 })]))).toHaveLength(1);
  });

  it("reads the backdrop from the nearest opaque ancestor fill", () => {
    const r = lint([frame("f", { fill: "#222222", children: [text("t", { fill: "#333333" })] })]);
    expect(contrastOf(r)).toHaveLength(1);
    const ok = lint([frame("f", { fill: "#222222", children: [text("t", { fill: "#ffffff" })] })]);
    expect(contrastOf(ok)).toHaveLength(0);
  });

  it("uses the topmost containing sibling as backdrop and ignores one that does not contain the text", () => {
    const children = (card: Record<string, unknown>) => [
      frame("f", { fill: "#ffffff", width: 300, children: [rect("card", { x: 0, y: 0, width: 150, height: 100, ...card }), text("t", { x: 10, y: 10, width: 50, height: 20, fill: "#eeeeee" })] }),
    ];
    expect(contrastOf(lint(children({ fill: "#000000" })))).toHaveLength(0);
    expect(contrastOf(lint(children({ fill: "#000000", width: 20 })))).toHaveLength(1);
    expect(contrastOf(lint(children({ fill: "#000000", visible: false })))).toHaveLength(1);
  });

  it("does not let a sibling above the text count as a backdrop", () => {
    const r = lint([frame("f", { fill: "#ffffff", children: [text("t", { fill: "#eeeeee" }), rect("later", { fill: "#000000" })] })]);
    expect(contrastOf(r)).toHaveLength(1);
  });

  it("composites translucent layers over what is behind them", () => {
    const r = lint([frame("f", { fill: "#ffffff", children: [rect("veil", { fill: "#00000080", width: 100, height: 100 }), text("t", { fill: "#808080", x: 1, y: 1, width: 10, height: 10 })] })]);
    const [f] = contrastOf(r);
    assertDefined(f);
    expect(f.message).toMatch(/on #7f7f7f|on #808080/);
  });

  it("composites a translucent text color over the backdrop", () => {
    const r = lint([text("t", { fills: [solid("#000000", { opacity: 0.4 })] })]);
    expect(contrastOf(r)).toHaveLength(1);
    expect(contrastOf(lint([text("t", { fills: [solid("#000000", { opacity: 0.9 })] })]))).toHaveLength(0);
  });

  it("evaluates each mode and labels the failing one", () => {
    const fg = token("fg", "--fg", { light: "#111111", dark: "#333333" });
    const bg = token("bg", "--bg", { light: "#ffffff", dark: "#000000" });
    const r = lint(
      [frame("f", { fill: "#000", fillBinding: { variableId: "bg" }, children: [text("t", { fill: "#111", fillBinding: { variableId: "fg" } })] })],
      { variables: [fg, bg] },
    );
    const found = contrastOf(r);
    expect(found).toHaveLength(1);
    expect(found[0].mode).toBe("Theme=Dark");
    expect(found[0].id).toMatch(/^contrast:/);
  });

  it("resolves the backdrop under the frame's own mode override", () => {
    const bg = token("bg", "--bg", { light: "#ffffff", dark: "#000000" });
    const r = lint(
      [frame("outer", { modeOverrides: { theme: "dark" }, children: [frame("inner", { fill: "#fff", fillBinding: { variableId: "bg" }, children: [text("t", { fill: "#ffffff" })] })] })],
      { variables: [bg] },
    );
    // The inner frame's fill resolves in the dark context (black), so white text passes in every run.
    expect(contrastOf(r)).toHaveLength(0);
  });

  it("reports info instead of guessing over images, styles and blend modes", () => {
    const over = (fills: unknown[]) => lint([frame("f", { fills, children: [text("t", { fill: "#777777" })] })]);
    for (const fills of [
      [{ id: "i", type: "image", image: { url: "x", mode: "fill" } }],
      [solid("#ffffff"), { id: "i", type: "image", image: { url: "x", mode: "fill" } }],
      [{ ...solid("#ffffff"), blendMode: "multiply" }],
    ]) {
      const found = contrastOf(over(fills));
      expect(found).toHaveLength(1);
      expect(found[0].severity).toBe("info");
    }
  });

  it("uses the worst gradient stop and downgrades to info", () => {
    const grad = (c1: string, c2: string) => [{ id: "g", type: "gradient", gradient: { type: "linear", startX: 0, startY: 0, endX: 1, endY: 0, stops: [{ color: c1, position: 0 }, { color: c2, position: 1 }] } }];
    const bad = lint([frame("f", { fills: grad("#ffffff", "#888888"), children: [text("t", { fill: "#000000" })] })]);
    expect(contrastOf(bad)).toHaveLength(0);
    const worse = lint([frame("f", { fills: grad("#ffffff", "#333333"), children: [text("t", { fill: "#000000" })] })]);
    expect(contrastOf(worse)[0]?.severity).toBe("info");
  });

  it("skips empty and hidden text, honors scoping", () => {
    expect(contrastOf(lint([text("a", { fill: "#777", text: "  " }), text("b", { fill: "#777", visible: false })]))).toHaveLength(0);
    const roots = [text("a", { fill: "#777777" }), text("b", { fill: "#777777" })];
    expect(contrastOf(lint(roots, {}, { nodeIds: ["b"] })).map((f) => f.nodeId)).toEqual(["b"]);
  });

  it("checks stroke boundaries at 3:1 only when asked", () => {
    const roots = [rect("box", { stroke: "#dddddd", strokeWidth: 1 })];
    expect(contrastOf(lint(roots))).toHaveLength(0);
    const [f] = contrastOf(lint(roots, {}, { uiContrast: true }));
    assertDefined(f);
    expect(f.severity).toBe("warning");
    expect(f.message).toContain("3:1");
  });

  it("falls back to the page background", () => {
    const r = lint([text("t", { fill: "#bbbbbb" })], { pageBackground: "#000000" });
    expect(contrastOf(r)).toHaveLength(0);
  });

  describe("text foreground mirrors the renderer", () => {
    it("treats a text node with no fills as black", () => {
      expect(contrastOf(lint([text("t")], { pageBackground: "#000000" }))).toHaveLength(1);
      expect(contrastOf(lint([text("t")]))).toHaveLength(0);
    });

    it("treats a linked text node with no fills as link blue", () => {
      const [f] = contrastOf(lint([text("t", { link: { url: "https://example.com" } })]));
      assertDefined(f);
      expect(f.message).toContain("#0d99ff");
    });

    it("uses the topmost SOLID paint, skipping gradients above it", () => {
      const gradient = { id: "g", type: "gradient", gradient: { type: "linear", angle: 0, stops: [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "#ffffff" }] } };
      const r = lint([text("t", { fills: [solid("#000000"), gradient] })]);
      expect(contrastOf(r)).toHaveLength(0);
    });

    it("skips invisible solids when picking the topmost", () => {
      const r = lint([text("t", { fills: [solid("#000000"), solid("#bbbbbb", { visible: false })] })]);
      expect(contrastOf(r)).toHaveLength(0);
    });
  });

  it("counts strokeWidthPerSide as a drawn stroke for UI contrast", () => {
    const roots = [rect("box", { stroke: "#dddddd", strokeWidthPerSide: { top: 0, right: 0, bottom: 2, left: 0 } })];
    expect(contrastOf(lint(roots, {}, { uiContrast: true }))).toHaveLength(1);
  });

  describe("fix", () => {
    const ink = token("v-ink", "--ink", "#111111");
    const grey = token("v-grey", "--grey", "#595959");
    const faint = token("v-faint", "--faint", "#dddddd");

    it("binds the nearest passing token, in a stacked paint or a legacy fill", () => {
      const [legacy] = contrastOf(lint([text("t", { fill: "#aaaaaa" })], { variables: [ink, grey, faint] }));
      expect(legacy.fix).toEqual({ kind: "bind-color", nodeId: "t", slot: "fill", paintId: undefined, variableId: "v-grey", from: "#aaaaaa" });
      const [stacked] = contrastOf(lint([text("t", { fills: [solid("#aaaaaa", { id: "p1" })] })], { variables: [ink, grey] }));
      expect(stacked.fix).toMatchObject({ paintId: "p1", variableId: "v-grey" });
    });

    it("offers no fix without a passing token, for bound paints, or in any mode where the token fails", () => {
      expect(contrastOf(lint([text("t", { fill: "#aaaaaa" })], { variables: [faint] }))[0].fix).toBeUndefined();
      const bound = text("t", { fill: "#aaaaaa", fillBinding: { variableId: "v-faint" } });
      expect(contrastOf(lint([bound], { variables: [ink, faint] }))[0].fix).toBeUndefined();
      const darkFails = token("v-split", "--split", { light: "#111111", dark: "#222222" });
      const onDark = frame("f", { fill: "#101010", children: [text("t", { fill: "#303030" })] });
      expect(contrastOf(lint([onDark], { variables: [darkFails] }))[0].fix).toBeUndefined();
    });
  });
});
