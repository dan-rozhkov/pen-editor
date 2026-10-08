import { describe, expect, it } from "vitest";
import {
  getEffectiveModeContext,
  getFrameModeOverrides,
  mergeModeContext,
  migrateFrameModeOverrides,
  modeContextKey,
  modeOverridesEqual,
  pruneModeOverrides,
  sanitizeModeContext,
  withThemeOverrideMirror,
} from "@/lib/variables/modeContext";
import { makeThemeCollection } from "@/lib/variables";
import type { VariableCollection } from "@/types/variable";
import type { FlatSceneNode, SceneNode } from "@/types/scene";

const brand: VariableCollection = {
  id: "brand",
  name: "Brand",
  modes: [
    { id: "acme", name: "Acme" },
    { id: "globex", name: "Globex" },
  ],
  defaultModeId: "acme",
};
const collections = [makeThemeCollection(), brand];

const frame = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: "frame", x: 0, y: 0, width: 10, height: 10, ...extra }) as unknown as FlatSceneNode;

describe("getFrameModeOverrides (compat choke point)", () => {
  it("reads modeOverrides", () => {
    expect(getFrameModeOverrides(frame("f", { modeOverrides: { brand: "globex" } }))).toEqual({ brand: "globex" });
  });
  it("maps a legacy themeOverride to the Theme collection", () => {
    expect(getFrameModeOverrides(frame("f", { themeOverride: "dark" }))).toEqual({ theme: "dark" });
  });
  it("prefers modeOverrides over themeOverride", () => {
    expect(getFrameModeOverrides(frame("f", { modeOverrides: { theme: "light" }, themeOverride: "dark" }))).toEqual({ theme: "light" });
  });
  it("is empty for a plain frame or a non-frame", () => {
    expect(getFrameModeOverrides(frame("f"))).toEqual({});
    expect(getFrameModeOverrides({ type: "rect", themeOverride: "dark" } as never)).toEqual({});
  });
});

describe("merge and equality", () => {
  it("merges overrides over a base, leaving other collections alone", () => {
    expect(mergeModeContext({ theme: "light", brand: "acme" }, { theme: "dark" })).toEqual({ theme: "dark", brand: "acme" });
  });
  it("modeContextKey is order independent", () => {
    expect(modeContextKey({ a: "1", b: "2" })).toBe(modeContextKey({ b: "2", a: "1" }));
    expect(modeContextKey({ a: "1" })).not.toBe(modeContextKey({ a: "2" }));
  });
  it("modeOverridesEqual compares by content", () => {
    expect(modeOverridesEqual({ theme: "dark" }, { theme: "dark" })).toBe(true);
    expect(modeOverridesEqual({ theme: "dark" }, { theme: "light" })).toBe(false);
    expect(modeOverridesEqual({}, undefined)).toBe(true);
    expect(modeOverridesEqual({ theme: "dark" }, { theme: "dark", brand: "acme" })).toBe(false);
  });
});

describe("getEffectiveModeContext", () => {
  const nodesById = {
    outer: frame("outer", { modeOverrides: { theme: "dark", brand: "globex" } }),
    inner: frame("inner", { modeOverrides: { theme: "light" } }),
    leaf: { id: "leaf", type: "rect" } as unknown as FlatSceneNode,
  };
  const parentById = { outer: null, inner: "outer", leaf: "inner" };

  it("merges root to leaf, inner wins, partial overrides keep outer picks", () => {
    expect(getEffectiveModeContext(parentById, nodesById, "leaf", { theme: "light", brand: "acme" })).toEqual({
      theme: "light",
      brand: "globex",
    });
  });
  it("excludes the node itself by default", () => {
    expect(getEffectiveModeContext(parentById, nodesById, "inner", { theme: "light" })).toEqual({ theme: "dark", brand: "globex" });
  });
  it("includes the node itself on request", () => {
    expect(getEffectiveModeContext(parentById, nodesById, "outer", { theme: "light" }, { includeSelf: true })).toEqual({
      theme: "dark",
      brand: "globex",
    });
  });
  it("honours a legacy themeOverride frame", () => {
    const n = { f: frame("f", { themeOverride: "dark" }), c: frame("c") };
    expect(getEffectiveModeContext({ f: null, c: "f" }, n, "c", { theme: "light" })).toEqual({ theme: "dark" });
  });
});

describe("pruning and migration", () => {
  it("prunes unknown collections and modes, and returns undefined when nothing is left", () => {
    expect(pruneModeOverrides({ theme: "dark", ghost: "x", brand: "nope" }, collections)).toEqual({ theme: "dark" });
    expect(pruneModeOverrides({ ghost: "x" }, collections)).toBeUndefined();
    expect(pruneModeOverrides(undefined, collections)).toBeUndefined();
  });
  it("sanitizeModeContext drops unknown ids", () => {
    expect(sanitizeModeContext({ theme: "dark", brand: "zzz", ghost: "a" }, collections)).toEqual({ theme: "dark" });
  });
  it("migrates themeOverride into modeOverrides and drops the old key", () => {
    const nodes = { f: frame("f", { themeOverride: "dark" }), g: frame("g") };
    const out = migrateFrameModeOverrides(nodes, collections);
    expect(out.f).toMatchObject({ modeOverrides: { theme: "dark" } });
    expect("themeOverride" in out.f).toBe(false);
    expect(out.g).toBe(nodes.g);
  });
  it("prunes a stale modeOverrides entry at load", () => {
    const out = migrateFrameModeOverrides({ f: frame("f", { modeOverrides: { brand: "gone", theme: "dark" } }) }, collections);
    expect(out.f).toMatchObject({ modeOverrides: { theme: "dark" } });
    const none = migrateFrameModeOverrides({ f: frame("f", { modeOverrides: { brand: "gone" } }) }, collections);
    expect("modeOverrides" in none.f).toBe(false);
  });
});

describe("withThemeOverrideMirror (dual-write)", () => {
  it("writes the themeOverride mirror next to modeOverrides, recursively", () => {
    const tree = [
      { ...frame("a", { modeOverrides: { theme: "dark", brand: "globex" } }), children: [{ ...frame("b", { themeOverride: "dark" }), children: [] }] },
    ] as unknown as SceneNode[];
    const out = withThemeOverrideMirror(tree) as unknown as Array<Record<string, unknown> & { children: Array<Record<string, unknown>> }>;
    expect(out[0].themeOverride).toBe("dark");
    expect(out[0].modeOverrides).toEqual({ theme: "dark", brand: "globex" });
    expect(out[0].children[0]).toMatchObject({ themeOverride: "dark", modeOverrides: { theme: "dark" } });
  });
  it("omits the mirror when there is no theme pick and drops empty overrides", () => {
    const tree = [frame("a", { modeOverrides: { brand: "globex" }, themeOverride: "dark" }), frame("b", { modeOverrides: {} })] as unknown as SceneNode[];
    const out = withThemeOverrideMirror(tree) as unknown as Array<Record<string, unknown>>;
    expect("themeOverride" in out[0]).toBe(false);
    expect("modeOverrides" in out[1]).toBe(false);
  });
  it("leaves untouched trees referentially intact", () => {
    const tree = [frame("a")] as unknown as SceneNode[];
    expect(withThemeOverrideMirror(tree)).toBe(tree);
  });
});
