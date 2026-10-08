import { describe, it, expect, vi } from "vitest";
import * as variableTypes from "@/types/variable";
import { buildVariableIndex, resolveVariable, modeValuesOf } from "@/lib/variables";
import { assertDefined } from "@/test/assertions";
import { buildDesignSystem } from "../build";
import type { DesignSystemArgs } from "../types";
import type { DesignSystemScope } from "@/types/designSystemScope";
import type { Variable } from "@/types/variable";
import { BTN_HTML, COLLECTIONS, VARIABLES, componentInput, makeInput, master } from "./dsFixtures";

const tokenNames = (args: DesignSystemArgs, input = makeInput()) =>
  (buildDesignSystem(input, args).tokens ?? []).map((t) => t.name);

describe("buildDesignSystem: shape", () => {
  const result = buildDesignSystem(makeInput(), {});

  it("returns the versioned result with every default section", () => {
    expect(result.schema).toBe(1);
    expect(result.scope).toEqual({ saved: null, applied: {} });
    expect(result.modeContext).toEqual({ theme: "light", brand: "a" });
    expect(result.lint).toBeUndefined();
    expect(result).not.toHaveProperty("library");
    expect(result.truncated).toBe(false);
    expect(result.tokens).toHaveLength(VARIABLES.length);
    expect(result.components).toHaveLength(1);
  });

  it("marks a collection semantic only when it aliases another collection", () => {
    expect(result.collections.map((c) => [c.name, c.tier])).toEqual([
      ["Theme", "semantic"],
      ["Brand", "primitive"],
    ]);
  });

  it("describes a component without any HTML", () => {
    const btn = result.components?.[0];
    assertDefined(btn);
    expect(btn).toMatchObject({
      key: "btn",
      name: "BTN",
      status: "stable",
      description: "A button",
      variants: { kind: ["primary", "ghost"] },
      slots: ["label"],
      usage: { instances: 5, embeds: 2 },
      warnings: [],
    });
    expect(JSON.stringify(result)).not.toContain("<button");
    expect(JSON.stringify(result)).not.toContain("<style");
  });

  it("completes the mode context with collection defaults", () => {
    const partial = buildDesignSystem(makeInput({ modeContext: { theme: "dark" } }), {});
    expect(partial.modeContext).toEqual({ theme: "dark", brand: "a" });
  });

  it("honors include", () => {
    const only = buildDesignSystem(makeInput(), { include: ["components"] });
    expect(only.tokens).toBeUndefined();
    expect(only.lint).toBeUndefined();
    expect(only.components).toHaveLength(1);
  });
});

describe("buildDesignSystem: lint section", () => {
  it("reports an unavailable empty catalog when no rules are injected", () => {
    expect(buildDesignSystem(makeInput(), { include: ["lint"] }).lint).toEqual({ rules: [], available: false });
  });

  it("returns the injected rule catalog as available", () => {
    const lintRules = [{ id: "contrast", severity: "warning" as const, description: "Low contrast", autoFix: false }];
    const result = buildDesignSystem(makeInput({ lintRules }), { include: ["lint"] });
    expect(result.lint).toEqual({ rules: lintRules, available: true });
    expect(result.tokens).toBeUndefined();
  });
});

describe("buildDesignSystem: token values", () => {
  it("reports resolved null and an error when a mode does not resolve", () => {
    const broken: Variable = {
      id: "v-loop",
      name: "--loop",
      type: "color",
      collectionId: "theme",
      valuesByMode: { light: { alias: "v-loop" }, dark: "#000000" },
      value: "#123456",
    };
    const token = (buildDesignSystem(makeInput({ variables: [broken] }), {}).tokens ?? [])[0];
    expect(token.values.Light.resolved).toBeNull();
    expect(token.values.Light.error).toBe("cycle");
    expect(token.values.Dark).toEqual({ raw: "#000000", resolved: "#000000" });
  });

  it("matches resolveVariable for every variable and mode (what get_variables reports)", () => {
    const index = buildVariableIndex(VARIABLES, COLLECTIONS);
    const tokens = buildDesignSystem(makeInput(), {}).tokens ?? [];
    for (const v of VARIABLES) {
      const token = tokens.find((t) => t.name === v.name);
      assertDefined(token);
      const collection = COLLECTIONS.find((c) => c.id === v.collectionId);
      assertDefined(collection);
      for (const mode of collection.modes) {
        const expected = resolveVariable(index, v.id, { [collection.id]: mode.id });
        expect(token.values[mode.name].resolved).toBe(expected.ok ? expected.value : v.value);
        expect(modeValuesOf(v)[mode.id]).toBeDefined();
      }
    }
  });

  it("writes an alias as its target reference in raw", () => {
    const tokens = buildDesignSystem(makeInput(), {}).tokens ?? [];
    const hover = tokens.find((t) => t.name === "--primary-hover");
    assertDefined(hover);
    expect(hover.values.Light).toEqual({ raw: "$--accent-hover", resolved: "#0000cc" });
    expect(hover.values.Dark).toEqual({ raw: "$--primary", resolved: "#88aaff" });
    expect(hover.cssName).toBe("--primary-hover");
    expect(hover.collection).toBe("Theme");
  });

  it("reports a deprecated token's replacedBy as a reference", () => {
    const old = (buildDesignSystem(makeInput(), {}).tokens ?? []).find((t) => t.name === "--old-blue");
    expect(old?.deprecated).toEqual({ since: "1.0", replacedBy: "$--accent", note: "Use accent." });
  });

  it("keeps only the requested mode of the named collection", () => {
    const tokens = buildDesignSystem(makeInput(), { mode: { Brand: "B" } }).tokens ?? [];
    const accent = tokens.find((t) => t.name === "--accent");
    expect(Object.keys(accent?.values ?? {})).toEqual(["B"]);
    const text = tokens.find((t) => t.name === "--text");
    expect(Object.keys(text?.values ?? {})).toEqual(["Light", "Dark"]);
  });

  it("reads a string mode as a Theme mode and sets the modeContext", () => {
    const result = buildDesignSystem(makeInput(), { mode: "dark" });
    expect(result.modeContext).toEqual({ theme: "dark", brand: "a" });
    expect(Object.keys(result.tokens?.find((t) => t.name === "--text")?.values ?? {})).toEqual(["Dark"]);
  });

  it("hints about a mode that does not exist and ignores it", () => {
    const result = buildDesignSystem(makeInput(), { mode: { Brand: "Zed" } });
    expect(result.hint).toContain("No mode matches Brand: Zed");
    expect(result.modeContext).toEqual({ theme: "light", brand: "a" });
  });
});

describe("buildDesignSystem: components under a mode", () => {
  it("returns the hover hex under {Brand: B, Theme: dark}", () => {
    const result = buildDesignSystem(makeInput(), { mode: { Brand: "B", Theme: "dark" }, scope: { components: ["btn"] } });
    const hover = result.components?.[0].tokenUses.find((u) => u.token === "--primary-hover" && u.selector.includes(":hover"));
    expect(hover?.resolved).toBe("#88aaff");
    const light = buildDesignSystem(makeInput(), { mode: { Brand: "B", Theme: "light" } });
    const lightHover = light.components?.[0].tokenUses.find((u) => u.token === "--primary-hover");
    expect(lightHover?.resolved).toBe("#cc0000");
  });

  it("surfaces component deprecation and warnings", () => {
    const old = componentInput(
      master("old-btn", `<button data-c="old-btn">x</button>`, { status: "deprecated", deprecated: { replacedBy: "btn", note: "n" } }),
      undefined,
      ["duplicate master"],
    );
    const result = buildDesignSystem(makeInput({ components: [old] }), {});
    expect(result.components?.[0]).toMatchObject({
      status: "deprecated",
      deprecated: { replacedBy: "btn", note: "n" },
      warnings: ["duplicate master"],
    });
  });

  it("lists a component whose master no longer parses, with empty details", () => {
    const broken = componentInput(master("broken", `<div></div><div></div>`));
    const result = buildDesignSystem(makeInput({ components: [broken] }), {});
    expect(result.components?.[0]).toMatchObject({ key: "broken", slots: [], tokenUses: [], variants: {} });
  });
});

describe("buildDesignSystem: scope filters", () => {
  it("filters by collection name or id", () => {
    expect(tokenNames({ scope: { collections: ["brand"] } })).toEqual(["--accent", "--accent-hover", "--old-blue"]);
    expect(tokenNames({ scope: { collections: ["Theme"] } })).toEqual(["--primary", "--primary-hover", "--text", "--radius"]);
    const result = buildDesignSystem(makeInput(), { scope: { collections: ["Brand"] } });
    expect(result.collections.map((c) => c.id)).toEqual(["brand"]);
  });

  it("hints about an unknown collection and returns no tokens", () => {
    const result = buildDesignSystem(makeInput(), { scope: { collections: ["Nope"] } });
    expect(result.tokens).toEqual([]);
    expect(result.hint).toContain('No collection matches "Nope"');
  });

  it("filters by token scope, keeping unscoped tokens", () => {
    expect(tokenNames({ scope: { tokenScopes: ["text"] } })).toEqual(["--text", "--old-blue"]);
  });

  it("filters by name globs", () => {
    expect(tokenNames({ scope: { names: ["--primary*"] } })).toEqual(["--primary", "--primary-hover"]);
    expect(tokenNames({ scope: { names: ["--accent-?over"] } })).toEqual(["--accent-hover"]);
    expect(tokenNames({ scope: { names: ["--TEXT"] } })).toEqual(["--text"]);
  });

  it("treats regex characters in a glob literally", () => {
    expect(tokenNames({ scope: { names: ["--(a+)+$"] } })).toEqual([]);
  });

  it("filters components by key, status and name glob", () => {
    const input = makeInput({
      components: [
        componentInput(master("btn", BTN_HTML)),
        componentInput(master("card", `<div data-c="card"></div>`, { status: "draft" })),
        componentInput(master("chip", `<span data-c="chip"></span>`, { status: "deprecated" })),
      ],
    });
    const keys = (args: DesignSystemArgs) => (buildDesignSystem(input, args).components ?? []).map((c) => c.key);
    expect(keys({})).toEqual(["btn", "card", "chip"]);
    expect(keys({ scope: { components: ["card", "chip"] } })).toEqual(["card", "chip"]);
    expect(keys({ scope: { componentStatus: ["draft", "deprecated"] } })).toEqual(["card", "chip"]);
    expect(keys({ scope: { components: ["card"], componentStatus: ["draft"] } })).toEqual(["card"]);
  });

  it("applies names globs to tokens only, never to components", () => {
    const input = makeInput({
      components: [componentInput(master("btn", BTN_HTML)), componentInput(master("card", `<div data-c="card"></div>`))],
    });
    const result = buildDesignSystem(input, { scope: { names: ["--primary*"] } });
    expect((result.components ?? []).map((c) => c.key)).toEqual(["btn", "card"]);
    expect((result.tokens ?? []).map((t) => t.name)).toEqual(["--primary", "--primary-hover"]);
  });

  it("hints which filter emptied the tokens", () => {
    expect(buildDesignSystem(makeInput(), { scope: { names: ["--zzz*"] } }).hint).toContain("names");
    expect(buildDesignSystem(makeInput(), { scope: { collections: ["Theme"], tokenScopes: ["stroke"] } }).hint).toContain("tokenScopes");
  });

  it("hints which filter emptied the components", () => {
    const hint = buildDesignSystem(makeInput(), { scope: { components: ["nope"] } }).hint;
    expect(hint).toContain("components");
    expect(buildDesignSystem(makeInput(), { scope: { componentStatus: ["draft"] } }).hint).toContain("componentStatus");
  });

  it("gives no emptied-filter hint when the document has no components", () => {
    expect(buildDesignSystem(makeInput({ components: [] }), { scope: { components: ["nope"] } }).hint).toBeUndefined();
  });
});

describe("buildDesignSystem: saved scopes", () => {
  const saved: DesignSystemScope[] = [
    { id: "s1", name: "Brand only", collections: ["brand"], tokenScopes: ["fill"], modes: { brand: ["b"] } },
    { id: "s2", name: "Buttons", components: { keys: ["btn"] } },
  ];
  const input = makeInput({ savedScopes: saved });

  it("applies a saved scope by name or id and reports it", () => {
    const result = buildDesignSystem(input, { scope: { saved: "brand only" } });
    expect((result.tokens ?? []).map((t) => t.name)).toEqual(["--accent", "--accent-hover", "--old-blue"]);
    expect(result.scope.saved).toBe("Brand only");
    expect(result.scope.applied).toMatchObject({ collections: ["Brand"], tokenScopes: ["fill"], modes: { brand: ["b"] } });
    expect(Object.keys(result.tokens?.[0].values ?? {})).toEqual(["B"]);
    expect(buildDesignSystem(input, { scope: { saved: "s1" } }).scope.saved).toBe("Brand only");
  });

  it("never widens a saved scope: a disjoint explicit collection yields nothing", () => {
    const result = buildDesignSystem(input, { scope: { saved: "Brand only", collections: ["Theme"] } });
    expect(result.tokens).toEqual([]);
    expect(result.collections).toEqual([]);
  });

  it("intersects list filters with the saved scope", () => {
    const wide = makeInput({
      savedScopes: [
        { id: "w", name: "Wide", collections: ["theme", "brand"], tokenScopes: ["fill", "text"], components: { keys: ["btn", "card"] }, names: ["--*t*"] },
      ],
      components: [
        componentInput(master("btn", BTN_HTML)),
        componentInput(master("card", `<div data-c="card"></div>`)),
        componentInput(master("chip", `<span data-c="chip"></span>`)),
      ],
    });
    const r = buildDesignSystem(wide, { scope: { saved: "Wide", collections: ["Theme"], tokenScopes: ["text", "radius"], components: ["card", "chip"] } });
    expect(r.scope.applied).toMatchObject({ collections: ["Theme"], tokenScopes: ["text"], components: ["card"] });
    expect((r.tokens ?? []).map((t) => t.name)).toEqual(["--text"]);
    expect((r.components ?? []).map((c) => c.key)).toEqual(["card"]);
  });

  it("requires a token name to match both the saved and the explicit globs", () => {
    const both = makeInput({ savedScopes: [{ id: "n", name: "Prim", names: ["--primary*"] }] });
    expect(tokenNames({ scope: { saved: "Prim", names: ["*hover"] } }, both)).toEqual(["--primary-hover"]);
    expect(tokenNames({ scope: { saved: "Prim", names: ["--text"] } }, both)).toEqual([]);
  });

  it("applies the component part of a saved scope", () => {
    const withTwo = makeInput({
      savedScopes: saved,
      components: [componentInput(master("btn", BTN_HTML)), componentInput(master("card", `<div data-c="card"></div>`))],
    });
    expect((buildDesignSystem(withTwo, { scope: { saved: "Buttons" } }).components ?? []).map((c) => c.key)).toEqual(["btn"]);
  });

  it("hints with the saved names when the scope is unknown, and applies nothing", () => {
    const result = buildDesignSystem(input, { scope: { saved: "Nope" } });
    expect(result.scope).toEqual({ saved: null, applied: {} });
    expect(result.tokens).toHaveLength(VARIABLES.length);
    expect(result.hint).toContain('No saved scope matches "Nope"');
    expect(result.hint).toContain("Brand only, Buttons");
  });
});

describe("buildDesignSystem: limit and truncation", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `v-n${i}`,
    name: `--n${String(i).padStart(2, "0")}`,
    type: "number" as const,
    collectionId: "theme",
    valuesByMode: { light: String(i), dark: String(i) },
    value: String(i),
  }));
  const input = makeInput({ variables: many });

  it("keeps the first tokens in collection then variable order and says what was cut", () => {
    const result = buildDesignSystem(input, { limit: 5 });
    expect((result.tokens ?? []).map((t) => t.name)).toEqual(["--n00", "--n01", "--n02", "--n03", "--n04"]);
    expect(result.truncated).toBe(true);
    expect(result.hint).toContain("7 more tokens");
  });

  it("is deterministic and not truncated when everything fits", () => {
    expect(JSON.stringify(buildDesignSystem(input, { limit: 5 }))).toBe(JSON.stringify(buildDesignSystem(input, { limit: 5 })));
    expect(buildDesignSystem(input, { limit: 12 }).truncated).toBe(false);
  });

  it("limits components separately and sorts them by key", () => {
    const components = ["zeta", "alpha", "mid"].map((k) => componentInput(master(k, `<div data-c="${k}"></div>`)));
    const result = buildDesignSystem(makeInput({ components }), { limit: 2 });
    expect((result.components ?? []).map((c) => c.key)).toEqual(["alpha", "mid"]);
    expect(result.truncated).toBe(true);
    expect(result.hint).toContain("1 more component");
  });

  it("clamps a bad limit to the default range", () => {
    expect(buildDesignSystem(input, { limit: 0 }).tokens).toHaveLength(12);
    expect(buildDesignSystem(input, { limit: -3 }).tokens).toHaveLength(12);
    expect(buildDesignSystem(input, { limit: Number.NaN }).tokens).toHaveLength(12);
  });
});

describe("buildDesignSystem: shared lookups", () => {
  it("builds the CSS-name lookup once per call, not once per component", () => {
    const spy = vi.spyOn(variableTypes, "getVariableCssName");
    const components = ["a", "b", "c"].map((k) => componentInput(master(k, `<div data-c="${k}" style="color: var(--text)"></div>`)));
    buildDesignSystem(makeInput({ components }), { include: ["components"] });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(VARIABLES.length);
    spy.mockRestore();
  });
});
