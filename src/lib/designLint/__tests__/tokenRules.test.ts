import { describe, expect, it } from "vitest";
import { assertDefined } from "@/test/assertions";
import { byRule, frame, lint, rect, text, token } from "./fixtures";

const surface = token("v-surface", "--surface", { light: "#ffffff", dark: "#111111" }, { scopes: ["fill"] });
const brand = token("v-brand", "--brand", "#3366ff");
const primary = token("v-primary", "--primary", { light: { alias: "v-brand" }, dark: { alias: "v-brand" } });

describe("hardcoded-value (colors)", () => {
  it("flags an unbound fill equal to a token and offers a bind fix", () => {
    const r = lint([rect("r1", { fill: "#FFFFFF", name: "Card" })], { variables: [surface] });
    const [f] = byRule(r, "hardcoded-value");
    assertDefined(f);
    expect(f.severity).toBe("warning");
    expect(f.nodeId).toBe("r1");
    expect(f.fix).toEqual({
      kind: "bind-color",
      nodeId: "r1",
      slot: "fill",
      paintId: undefined,
      variableId: "v-surface",
      from: "#FFFFFF",
    });
  });

  it("prefers the semantic alias tier and lists the others in detail", () => {
    const r = lint([rect("r1", { fill: "#3366ff" })], { variables: [brand, primary] });
    const [f] = byRule(r, "hardcoded-value");
    assertDefined(f);
    expect(f.fix).toMatchObject({ variableId: "v-primary" });
    expect(f.detail).toContain("--brand");
  });

  it("honors scopes: a fill-scoped token does not match text color or strokes", () => {
    const r = lint([text("t1", { fill: "#ffffff" }), rect("r1", { stroke: "#ffffff", strokeWidth: 1 })], {
      variables: [surface],
    });
    expect(byRule(r, "hardcoded-value")).toHaveLength(0);
  });

  it("treats an unscoped color token as valid anywhere", () => {
    const r = lint([text("t1", { fill: "#3366ff" })], { variables: [brand] });
    expect(byRule(r, "hardcoded-value")).toHaveLength(1);
  });

  it("skips bound fills, hidden nodes, disabled nodes and hidden subtrees", () => {
    const r = lint(
      [
        rect("bound", { fill: "#ffffff", fillBinding: { variableId: "v-surface" } }),
        rect("hidden", { fill: "#ffffff", visible: false }),
        rect("disabled", { fill: "#ffffff", enabled: false }),
        frame("wrap", { visible: false, children: [rect("inner", { fill: "#ffffff" })] }),
      ],
      { variables: [surface] },
    );
    expect(byRule(r, "hardcoded-value")).toHaveLength(0);
    expect(r.summary.scanned.nodes).toBe(1);
  });

  it("skips strokes that are not drawn and masks", () => {
    const r = lint([rect("r1", { stroke: "#3366ff" }), rect("m", { fill: "#3366ff", isMask: true })], {
      variables: [brand],
    });
    expect(byRule(r, "hardcoded-value")).toHaveLength(0);
  });

  it("handles a paint stack: ids per paint, fix carries the paint id", () => {
    const r = lint(
      [rect("r1", { fills: [{ id: "pa", type: "solid", color: "#3366ff" }, { id: "pb", type: "solid", color: "#3366ff" }] })],
      { variables: [brand] },
    );
    const fixes = byRule(r, "hardcoded-value").map((f) => (f.fix?.kind === "bind-color" ? f.fix.paintId : null));
    expect(fixes.sort()).toEqual(["pa", "pb"]);
    expect(new Set(byRule(r, "hardcoded-value").map((f) => f.id)).size).toBe(2);
  });

  it("matches under the node's effective mode (frame override) and keeps ids stable", () => {
    const dark = frame("f", { modeOverrides: { theme: "dark" }, children: [rect("r1", { fill: "#111111" })] });
    const a = lint([dark], { variables: [surface] });
    expect(byRule(a, "hardcoded-value").map((f) => f.nodeId)).toEqual(["r1"]);
    // Same literal outside the override: light #ffffff differs from #111111 in the light context,
    // but the dark context run (all modes are evaluated) still finds it.
    const b = lint([rect("r1", { fill: "#111111" })], { variables: [surface] });
    expect(byRule(b, "hardcoded-value")[0]?.mode).toBe("Theme=Dark");
    expect(byRule(a, "hardcoded-value")[0]?.id).toBe(byRule(lint([dark], { variables: [surface] }), "hardcoded-value")[0]?.id);
  });

  it("does not flag deprecated tokens as candidates", () => {
    const old = token("v-old", "--old", "#abcdef", { deprecated: { since: "1" } });
    const r = lint([rect("r1", { fill: "#abcdef" })], { variables: [old] });
    expect(byRule(r, "hardcoded-value")).toHaveLength(0);
  });
});

describe("hardcoded-value and off-scale-value (numbers)", () => {
  const radius = token("v-r8", "--radius-md", "8", { type: "number", scopes: ["radius"] });
  const space = token("v-s16", "--space-4", "16", { type: "number", scopes: ["spacing"] });
  const vars = [radius, space];

  it("flags a literal equal to a number token and binds it", () => {
    const r = lint([rect("r1", { cornerRadius: 8 })], { variables: vars });
    const [f] = byRule(r, "hardcoded-value");
    assertDefined(f);
    expect(f.fix).toEqual({ kind: "bind-number", nodeId: "r1", key: "cornerRadius", variableId: "v-r8", from: 8, changesValue: false });
  });

  it("flags padding only on auto-layout frames, only when a key is unbound", () => {
    const plain = lint([frame("f", { layout: { paddingTop: 16 } })], { variables: vars });
    expect(byRule(plain, "hardcoded-value")).toHaveLength(0);
    const auto = lint(
      [frame("f", { layout: { autoLayout: true, paddingTop: 16, paddingLeft: 16 }, numberBindings: { paddingLeft: { variableId: "v-s16" } } })],
      { variables: vars },
    );
    expect(byRule(auto, "hardcoded-value").map((f) => (f.fix?.kind === "bind-number" ? f.fix.key : ""))).toEqual(["paddingTop"]);
  });

  it("ignores number tokens without a matching scope and zero values", () => {
    const unscoped = token("v-x", "--x", "8", { type: "number" });
    const r = lint([rect("r1", { cornerRadius: 8 }), rect("r2", { cornerRadius: 0 })], { variables: [unscoped, radius] });
    expect(byRule(r, "hardcoded-value").map((f) => f.nodeId)).toEqual(["r1"]);
  });

  it("reports off-scale values within 25% or 2px as info, with a value-changing fix", () => {
    const r = lint([rect("near", { cornerRadius: 9 }), rect("far", { cornerRadius: 40 })], { variables: vars });
    const off = byRule(r, "off-scale-value");
    expect(off.map((f) => f.nodeId)).toEqual(["near"]);
    expect(off[0].severity).toBe("info");
    expect(off[0].fix).toMatchObject({ kind: "bind-number", changesValue: true, variableId: "v-r8" });
    expect(byRule(r, "hardcoded-value")).toHaveLength(0);
  });

  it("reports near colors as info without a fix", () => {
    const r = lint([rect("r1", { fill: "#3367ff" })], { variables: [brand] });
    const [f] = byRule(r, "off-scale-value");
    assertDefined(f);
    expect(f.severity).toBe("info");
    expect(f.fix).toBeUndefined();
    expect(byRule(lint([rect("r1", { fill: "#ff0000" })], { variables: [brand] }), "off-scale-value")).toHaveLength(0);
  });
});

describe("deprecated-token", () => {
  const oldTok = token("v-old", "--old", "#111111", { deprecated: { replacedBy: "v-new", note: "use new" } });
  const newTok = token("v-new", "--new", "#222222");
  const viaOld = token("v-alias", "--alias", { light: { alias: "v-old" }, dark: { alias: "v-old" } });

  it("rebinds a deprecated direct binding to replacedBy", () => {
    const r = lint([rect("r1", { fill: "#111111", fillBinding: { variableId: "v-old" } })], { variables: [oldTok, newTok] });
    const [f] = byRule(r, "deprecated-token");
    assertDefined(f);
    expect(f.severity).toBe("warning");
    expect(f.detail).toContain("--new");
    expect(f.fix).toMatchObject({ kind: "rebind", target: "fill", fromVariableId: "v-old", toVariableId: "v-new" });
  });

  it("follows replacedBy across deprecated hops and skips type-mismatched replacements", () => {
    const hop = token("v-hop", "--hop", "#333", { deprecated: { replacedBy: "v-new" } });
    const first = token("v-old2", "--old2", "#444", { deprecated: { replacedBy: "v-hop" } });
    const r = lint([rect("r1", { fills: [{ id: "p", type: "solid", color: "#444", colorBinding: { variableId: "v-old2" } }] })], {
      variables: [first, hop, newTok],
    });
    expect(byRule(r, "deprecated-token")[0].fix).toMatchObject({ toVariableId: "v-new", paintId: "p" });
    const num = token("v-n", "--n", "1", { type: "number" });
    const bad = token("v-bad", "--bad", "#444", { deprecated: { replacedBy: "v-n" } });
    const r2 = lint([rect("r1", { fill: "#444", fillBinding: { variableId: "v-bad" } })], { variables: [bad, num] });
    expect(byRule(r2, "deprecated-token")[0].fix).toBeUndefined();
  });

  it("flags an alias chain that resolves through a deprecated token, without a fix", () => {
    const r = lint([rect("r1", { fill: "#111111", fillBinding: { variableId: "v-alias" } })], { variables: [oldTok, newTok, viaOld] });
    const [f] = byRule(r, "deprecated-token");
    assertDefined(f);
    expect(f.message).toContain("resolves through");
    expect(f.fix).toBeUndefined();
  });

  it("covers number bindings and ignores dangling ones", () => {
    const n = token("v-n", "--n", "8", { type: "number", scopes: ["radius"], deprecated: { replacedBy: "v-n2" } });
    const n2 = token("v-n2", "--n2", "8", { type: "number", scopes: ["radius"] });
    const r = lint(
      [rect("r1", { cornerRadius: 8, numberBindings: { cornerRadius: { variableId: "v-n" } } }), rect("r2", { numberBindings: { cornerRadius: { variableId: "gone" } } })],
      { variables: [n, n2] },
    );
    const found = byRule(r, "deprecated-token");
    expect(found).toHaveLength(1);
    expect(found[0].fix).toMatchObject({ kind: "rebind", target: "cornerRadius", toVariableId: "v-n2" });
  });
});
