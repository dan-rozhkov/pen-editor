import { describe, expect, it } from "vitest";
import { assertDefined } from "@/test/assertions";
import { buildVariableIndex, getVariableIndex } from "../variableIndex";
import { getVariableValueAt, resolveModeId, resolveVariable, toModeContext } from "../resolve";
import { collections, v2Var } from "./fixtures";

const index = (vars: ReturnType<typeof v2Var>[]) => buildVariableIndex(vars, collections);

describe("toModeContext / resolveModeId", () => {
  it("maps a bare theme name onto the Theme collection", () => {
    expect(toModeContext("dark")).toEqual({ theme: "dark" });
    expect(toModeContext({ brand: "globex" })).toEqual({ brand: "globex" });
  });

  it("falls back to the collection default for a missing or unknown mode", () => {
    const idx = index([]);
    expect(resolveModeId(idx, "brand", {})).toBe("acme");
    expect(resolveModeId(idx, "brand", { brand: "nope" })).toBe("acme");
    expect(resolveModeId(idx, "brand", { brand: "globex" })).toBe("globex");
  });
});

describe("resolveVariable", () => {
  it("resolves a literal in the requested mode", () => {
    const idx = index([v2Var("a", "theme", { light: "#fff", dark: "#000" })]);
    expect(resolveVariable(idx, "a", "dark")).toMatchObject({ ok: true, value: "#000", modeId: "dark" });
    expect(resolveVariable(idx, "a", {})).toMatchObject({ ok: true, value: "#fff", modeId: "light" });
  });

  it("follows an alias chain", () => {
    const idx = index([
      v2Var("a", "theme", { light: { alias: "b" }, dark: "#111" }),
      v2Var("b", "theme", { light: { alias: "c" }, dark: "#222" }),
      v2Var("c", "theme", { light: "#333", dark: "#444" }),
    ]);
    expect(resolveVariable(idx, "a", "light")).toEqual({ ok: true, value: "#333", modeId: "light", chain: ["a", "b", "c"] });
    expect(resolveVariable(idx, "a", "dark")).toMatchObject({ ok: true, value: "#111" });
  });

  it("lets a cross-collection alias target react to its own mode", () => {
    const idx = index([
      v2Var("semantic", "theme", { light: { alias: "primitive" }, dark: { alias: "primitive" } }),
      v2Var("primitive", "brand", { acme: "#e00", globex: "#0a0" }),
    ]);
    expect(resolveVariable(idx, "semantic", { theme: "dark", brand: "globex" })).toMatchObject({ ok: true, value: "#0a0" });
    expect(resolveVariable(idx, "semantic", { theme: "dark" })).toMatchObject({ ok: true, value: "#e00" });
  });

  it("falls back to the default mode when the requested mode has no entry", () => {
    const idx = index([v2Var("a", "brand", { acme: "#e00" })]);
    expect(resolveVariable(idx, "a", { brand: "globex" })).toMatchObject({ ok: true, value: "#e00", modeId: "acme" });
  });

  it("reports a missing variable and a missing alias target", () => {
    const idx = index([v2Var("a", "theme", { light: { alias: "ghost" }, dark: "#000" })]);
    expect(resolveVariable(idx, "nope", "light")).toMatchObject({ ok: false, reason: "missing" });
    expect(resolveVariable(idx, "a", "light")).toMatchObject({ ok: false, reason: "missing" });
  });

  it("rejects an alias to a variable of another type", () => {
    const idx = index([
      v2Var("a", "theme", { light: { alias: "n" }, dark: { alias: "n" } }, "color"),
      v2Var("n", "theme", { light: "8", dark: "8" }, "number"),
    ]);
    expect(resolveVariable(idx, "a", "light")).toMatchObject({ ok: false, reason: "type-mismatch" });
  });

  it("detects a cycle at read time instead of looping", () => {
    const idx = index([
      v2Var("a", "theme", { light: { alias: "b" }, dark: "#000" }),
      v2Var("b", "theme", { light: { alias: "a" }, dark: "#000" }),
    ]);
    expect(resolveVariable(idx, "a", "light")).toMatchObject({ ok: false, reason: "cycle" });
  });

  it("stops at the depth cap", () => {
    const vars = Array.from({ length: 40 }, (_, i) =>
      v2Var(`v${i}`, "theme", { light: i === 39 ? "#abc" : { alias: `v${i + 1}` }, dark: "#000" }),
    );
    expect(resolveVariable(index(vars), "v0", "light")).toMatchObject({ ok: false, reason: "depth" });
    expect(resolveVariable(index(vars), "v10", "light")).toMatchObject({ ok: true, value: "#abc" });
  });

  it("treats a legacy-shaped variable (no valuesByMode) as light/dark in the Theme collection", () => {
    const idx = buildVariableIndex(
      [{ id: "l", name: "l", type: "color", value: "#fff", themeValues: { light: "#fff", dark: "#000" } }],
      collections,
    );
    expect(resolveVariable(idx, "l", "dark")).toMatchObject({ ok: true, value: "#000" });
  });
});

describe("getVariableValueAt", () => {
  it("returns the resolved value, and degrades to the mirror / type default when resolution fails", () => {
    const idx = index([
      v2Var("a", "theme", { light: { alias: "b" }, dark: "#000" }),
      v2Var("b", "theme", { light: { alias: "a" }, dark: "#000" }),
    ]);
    const a = idx.byId.get("a");
    assertDefined(a);
    expect(getVariableValueAt(a, "dark", idx)).toBe("#000");
    expect(getVariableValueAt(a, "light", idx)).toBe("#000000");
    expect(getVariableValueAt({ ...a, type: "number" }, "light", idx)).toBe("0");
    expect(getVariableValueAt({ ...a, value: "#123456" }, "light", idx)).toBe("#123456");
  });

  it("works without an index for a literal variable", () => {
    expect(getVariableValueAt(v2Var("a", "theme", { light: "#fff", dark: "#000" }), "dark")).toBe("#000");
  });
});

describe("getVariableIndex", () => {
  it("is cached by array identity and rebuilt when the array changes", () => {
    const vars = [v2Var("a", "theme", { light: "#fff", dark: "#000" })];
    expect(getVariableIndex(vars, collections)).toBe(getVariableIndex(vars, collections));
    expect(getVariableIndex([...vars], collections)).not.toBe(getVariableIndex(vars, collections));
  });

  it("synthesizes the Theme collection and unknown collections when none are given", () => {
    const idx = getVariableIndex([v2Var("a", "mystery", { x: "1", y: "2" }, "number")]);
    expect(idx.collections.get("theme")?.defaultModeId).toBe("light");
    expect(resolveVariable(idx, "a", {})).toMatchObject({ ok: true, value: "1" });
  });

  it("answers 10k lookups on a 2k-variable index quickly", () => {
    const vars = Array.from({ length: 2000 }, (_, i) => v2Var(`v${i}`, "theme", { light: "#fff", dark: "#000" }));
    const idx = getVariableIndex(vars, collections);
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) resolveVariable(idx, `v${i % 2000}`, "dark");
    expect(performance.now() - start).toBeLessThan(500);
  });
});
