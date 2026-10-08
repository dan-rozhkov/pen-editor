import { describe, expect, it } from "vitest";
import { assertDefined } from "@/test/assertions";
import type { Variable } from "@/types/variable";
import { makeThemeCollection, makeThemeVariable } from "../collections";
import { finalizeVariables, patchVariable, upgradeVariablesV2 } from "../migrate";
import { brandCollection, collections, v2Var } from "./fixtures";

describe("upgradeVariablesV2", () => {
  it("upgrades a legacy light/dark variable into the Theme collection", () => {
    const { variables, collections: out } = upgradeVariablesV2([
      { id: "p", name: "--p", type: "color", value: "#999999", themeValues: { light: "#111111", dark: "#eeeeee" } },
    ]);
    expect(out.map((c) => c.id)).toEqual(["theme"]);
    expect(variables[0]).toMatchObject({
      collectionId: "theme",
      valuesByMode: { light: "#111111", dark: "#eeeeee" },
      value: "#111111",
      themeValues: { light: "#111111", dark: "#eeeeee" },
    });
  });

  it("upgrades a value-only variable to identical light and dark", () => {
    const { variables } = upgradeVariablesV2([{ id: "r", name: "--r", type: "number", value: "8" }]);
    expect(variables[0]).toMatchObject({ valuesByMode: { light: "8", dark: "8" }, themeValues: { light: "8", dark: "8" } });
  });

  it("keeps a $name-style literal as a literal", () => {
    const { variables } = upgradeVariablesV2([{ id: "r", name: "--r", type: "color", value: "$other" }]);
    expect(variables[0].valuesByMode).toEqual({ light: "$other", dark: "$other" });
  });

  it("passes a v2 variable through and keeps extra collections", () => {
    const brand = v2Var("b", "brand", { acme: "#e00", globex: "#0a0" });
    const { variables, collections: out } = upgradeVariablesV2([brand], [brandCollection]);
    expect(out.map((c) => c.id)).toEqual(["theme", "brand"]);
    expect(variables[0]).toMatchObject({ collectionId: "brand", valuesByMode: brand.valuesByMode, value: "#e00" });
    expect(variables[0].themeValues).toBeUndefined();
  });

  it("reassigns a variable whose collection is unknown to the Theme collection", () => {
    const stray = v2Var("s", "ghost", { m1: "#abc", m2: "#def" });
    const { variables } = upgradeVariablesV2([stray]);
    expect(variables[0]).toMatchObject({ collectionId: "theme", valuesByMode: { light: "#abc", dark: "#abc" } });
  });

  it("is idempotent", () => {
    const once = upgradeVariablesV2([
      { id: "p", name: "p", type: "color", value: "#999999", themeValues: { light: "#111111", dark: "#eeeeee" } },
      v2Var("b", "brand", { acme: "#e00", globex: "#0a0" }),
    ], [brandCollection]);
    const twice = upgradeVariablesV2(once.variables, once.collections);
    expect(twice).toEqual(once);
  });

  it("ignores junk entries instead of throwing", () => {
    expect(upgradeVariablesV2([null, 3, { nope: true }]).variables).toEqual([]);
  });
});

describe("finalizeVariables", () => {
  it("recomputes mirrors after an alias target changes", () => {
    const target = makeThemeVariable("t", "#111111", "#222222");
    const alias: Variable = { ...v2Var("a", "theme", { light: { alias: target.id }, dark: { alias: target.id } }), value: "stale" };
    const first = finalizeVariables([target, alias], collections);
    expect(first[1]).toMatchObject({ value: "#111111", themeValues: { light: "#111111", dark: "#222222" } });

    const moved = { ...target, valuesByMode: { light: "#aaaaaa", dark: "#bbbbbb" } };
    const second = finalizeVariables([moved, first[1]], collections);
    const a = second[1];
    assertDefined(a);
    expect(a).toMatchObject({ value: "#aaaaaa", themeValues: { light: "#aaaaaa", dark: "#bbbbbb" } });
  });

  it("keeps the identity of variables whose mirrors did not change", () => {
    const t = makeThemeVariable("t", "#111111", "#222222");
    const out = finalizeVariables([t], [makeThemeCollection()]);
    expect(out[0]).toBe(t);
  });

  it("mirrors the default mode of a non-Theme collection into value only", () => {
    const out = finalizeVariables([v2Var("b", "brand", { acme: "#e00", globex: "#0a0" })], collections);
    expect(out[0].value).toBe("#e00");
    expect(out[0].themeValues).toBeUndefined();
  });
});

describe("patchVariable", () => {
  const themeCollections = [makeThemeCollection()];

  it("a legacy { value } patch edits the default mode of a two-valued Theme variable", () => {
    const base = makeThemeVariable("c", "#111111", "#222222");
    expect(patchVariable(base, { value: "#999999" }, themeCollections).valuesByMode).toEqual({ light: "#999999", dark: "#222222" });
  });

  it("a legacy { value } patch on a single-valued Theme variable edits both modes", () => {
    const base = makeThemeVariable("c", "#111111", "#111111");
    expect(patchVariable(base, { value: "#999999" }, themeCollections).valuesByMode).toEqual({ light: "#999999", dark: "#999999" });
  });

  it("adopts the Theme collection for a legacy-shaped variable, so the next upgrade keeps the edit", () => {
    const legacy: Variable = { id: "l", name: "l", type: "color", value: "#3366ff", themeValues: { light: "#3366ff", dark: "#99bbff" } };
    const patched = patchVariable(legacy, { value: "#111111" }, themeCollections);
    expect(upgradeVariablesV2([patched]).variables[0]).toMatchObject({ value: "#111111", themeValues: { light: "#111111", dark: "#99bbff" } });
  });
});
