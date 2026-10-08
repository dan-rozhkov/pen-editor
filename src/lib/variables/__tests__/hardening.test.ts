import { describe, expect, it } from "vitest";
import type { Variable, VariableCollection } from "@/types/variable";
import { getVariableIndex } from "../variableIndex";
import { sanitizeCollections, upgradeVariablesV2 } from "../migrate";
import { v2Var } from "./fixtures";

/** Brand whose DEFAULT mode is its SECOND mode. */
const brand2: VariableCollection = {
  id: "brand",
  name: "Brand",
  modes: [
    { id: "acme", name: "Acme" },
    { id: "globex", name: "Globex" },
  ],
  defaultModeId: "globex",
};

describe("sanitizeCollections / upgradeVariablesV2 on untrusted collections", () => {
  it("drops a collection without modes instead of throwing", () => {
    const bad = [{ id: "x", name: "X" }, { id: "y", name: "Y", modes: [], defaultModeId: "a" }];
    const out = upgradeVariablesV2([], bad as unknown as VariableCollection[]);
    expect(out.collections.map((c) => c.id)).toEqual(["theme"]);
  });

  it("drops non-objects, bad ids, bad mode entries and duplicate ids", () => {
    const raw = [
      null,
      "str",
      { id: 1, name: "n", modes: [{ id: "a", name: "A" }], defaultModeId: "a" },
      { id: "m", name: "M", modes: [{ id: "a" }], defaultModeId: "a" },
      { id: "ok", name: "Ok", modes: [{ id: "a", name: "A" }], defaultModeId: "a" },
      { id: "ok", name: "Dup", modes: [{ id: "b", name: "B" }], defaultModeId: "b" },
    ];
    expect(sanitizeCollections(raw).map((c) => c.id)).toEqual(["ok"]);
    expect(sanitizeCollections(raw)[0].name).toBe("Ok");
  });

  it("falls back to the first mode when defaultModeId is not among the modes", () => {
    const [c] = sanitizeCollections([{ ...brand2, defaultModeId: "nope" }]);
    expect(c.defaultModeId).toBe("acme");
  });

  it("keeps a valid collection as is", () => {
    expect(sanitizeCollections([brand2])).toEqual([brand2]);
  });

  it("returns [] for non-arrays", () => {
    expect(sanitizeCollections(undefined)).toEqual([]);
    expect(sanitizeCollections({})).toEqual([]);
  });

  it("variables pointing at a dropped collection fall back to Theme", () => {
    const v = v2Var("a", "ghost", { m1: "#111111" });
    const out = upgradeVariablesV2([v], [{ id: "ghost", name: "G" } as unknown as VariableCollection]);
    expect(out.variables[0]).toMatchObject({ collectionId: "theme", valuesByMode: { light: "#111111", dark: "#111111" } });
  });

  it("a malformed Theme collection is replaced by the built-in one", () => {
    const out = upgradeVariablesV2([], [{ id: "theme", name: "T" } as unknown as VariableCollection]);
    expect(out.collections[0].modes.map((m) => m.id)).toEqual(["light", "dark"]);
  });
});

describe("getVariableIndex cache", () => {
  const vars: Variable[] = [v2Var("a", "brand", { acme: "#111111", globex: "#222222" })];
  const colls = [brand2];

  it("does not thrash between undefined and a collections array", () => {
    const withColls = getVariableIndex(vars, colls);
    const without = getVariableIndex(vars);
    expect(getVariableIndex(vars, colls)).toBe(withColls);
    expect(getVariableIndex(vars)).toBe(without);
  });

  it("keeps separate slots per collections identity", () => {
    const other = [{ ...brand2 }];
    const a = getVariableIndex(vars, colls);
    const b = getVariableIndex(vars, other);
    expect(a).not.toBe(b);
    expect(getVariableIndex(vars, colls)).toBe(a);
  });
});
