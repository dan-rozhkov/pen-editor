import { describe, expect, it } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import type { Variable } from "@/types/variable";
import {
  computeBoundNumberPatches,
  dropDanglingNumberBindings,
  guardNumberBindings,
  pruneNumberBindings,
} from "../numberBindings";
import { makeThemeCollection } from "../collections";
import { upgradeVariablesV2 } from "../migrate";

const collections = [makeThemeCollection()];
const vars = (raw: Array<Record<string, unknown>>): Variable[] =>
  upgradeVariablesV2(raw, collections).variables;

const node = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: "frame", x: 0, y: 0, width: 100, height: 100, ...extra }) as unknown as FlatSceneNode;

const radius = { id: "r", name: "--radius", type: "number", value: "12" };

describe("computeBoundNumberPatches", () => {
  it("patches a node field and a nested layout field, only where the value differs", () => {
    const nodes = {
      a: node("a", {
        cornerRadius: 4,
        layout: { autoLayout: true, gap: 8, paddingTop: 4 },
        numberBindings: { cornerRadius: { variableId: "r" }, paddingTop: { variableId: "r" }, gap: { variableId: "r" } },
      }),
    };
    const patches = computeBoundNumberPatches(nodes, { a: null }, ["a"], vars([radius]), collections, "light");
    expect(patches.a).toEqual({ cornerRadius: 12, layout: { autoLayout: true, gap: 12, paddingTop: 12 } });
  });

  it("is idempotent: applying the patches yields no further patches", () => {
    const n = node("a", { cornerRadius: 4, numberBindings: { cornerRadius: { variableId: "r" } } });
    const patches = computeBoundNumberPatches({ a: n }, { a: null }, ["a"], vars([radius]), collections, "light");
    const applied = { a: { ...n, ...patches.a } as FlatSceneNode };
    expect(computeBoundNumberPatches(applied, { a: null }, ["a"], vars([radius]), collections, "light")).toEqual({});
  });

  it("resolves per mode, honoring an ancestor frame's themeOverride", () => {
    const v = vars([{ id: "r", name: "--r", type: "number", value: "1", themeValues: { light: "4", dark: "20" } }]);
    const nodes = {
      f: node("f", { themeOverride: "dark" }),
      c: node("c", { cornerRadius: 0, numberBindings: { cornerRadius: { variableId: "r" } } }),
    };
    const parents = { f: null, c: "f" };
    expect(computeBoundNumberPatches(nodes, parents, ["c"], v, collections, "light").c).toEqual({ cornerRadius: 20 });
    expect(
      computeBoundNumberPatches({ ...nodes, f: node("f") }, parents, ["c"], v, collections, "light").c,
    ).toEqual({ cornerRadius: 4 });
  });

  it("skips width/height unless the sizing mode is fixed", () => {
    const n = node("a", {
      width: 0,
      sizing: { widthMode: "fill_container" },
      numberBindings: { width: { variableId: "r" }, height: { variableId: "r" } },
    });
    expect(computeBoundNumberPatches({ a: n }, { a: null }, ["a"], vars([radius]), collections, "light").a).toEqual({
      height: 12,
    });
  });

  it("leaves a binding to a missing or non-number variable alone", () => {
    const n = node("a", {
      cornerRadius: 3,
      numberBindings: { cornerRadius: { variableId: "gone" }, gap: { variableId: "c" } },
    });
    const color = { id: "c", name: "--c", type: "color", value: "#fff" };
    expect(
      computeBoundNumberPatches({ a: n }, { a: null }, ["a"], vars([color]), collections, "light"),
    ).toEqual({});
  });

  it("clamps opacity to 0..1 and sizes to >= 0", () => {
    const big = vars([{ id: "o", name: "--o", type: "number", value: "5" }, { id: "n", name: "--n", type: "number", value: "-3" }]);
    const n = node("a", {
      opacity: 0.2,
      cornerRadius: 1,
      numberBindings: { opacity: { variableId: "o" }, cornerRadius: { variableId: "n" } },
    });
    expect(computeBoundNumberPatches({ a: n }, { a: null }, ["a"], big, collections, "light").a).toEqual({
      opacity: 1,
      cornerRadius: 0,
    });
  });
});

describe("unbind guard", () => {
  const bound = node("a", {
    cornerRadius: 12,
    layout: { gap: 8, paddingTop: 8 },
    numberBindings: { cornerRadius: { variableId: "r" }, gap: { variableId: "r" }, paddingTop: { variableId: "r" } },
  });

  it("drops a binding when its literal is rewritten with a different value", () => {
    const updates = { cornerRadius: 5 } as Partial<FlatSceneNode>;
    const out = guardNumberBindings(bound, { ...bound, ...updates } as FlatSceneNode, updates);
    expect(out.numberBindings).toEqual({ gap: { variableId: "r" }, paddingTop: { variableId: "r" } });
  });

  it("keeps the binding when the same literal is written back", () => {
    const updates = { cornerRadius: 12 } as Partial<FlatSceneNode>;
    const merged = { ...bound, ...updates } as FlatSceneNode;
    expect(guardNumberBindings(bound, merged, updates)).toBe(merged);
  });

  it("drops only the layout key whose value changed", () => {
    const updates = { layout: { gap: 8, paddingTop: 2 } } as Partial<FlatSceneNode>;
    const out = guardNumberBindings(bound, { ...bound, ...updates } as FlatSceneNode, updates);
    expect(out.numberBindings).toEqual({ cornerRadius: { variableId: "r" }, gap: { variableId: "r" } });
  });

  it("returns undefined bindings when none are left, and respects `keep`", () => {
    const only = node("b", { cornerRadius: 12, numberBindings: { cornerRadius: { variableId: "r" } } });
    const updates = { cornerRadius: 1 } as Partial<FlatSceneNode>;
    const merged = { ...only, ...updates } as FlatSceneNode;
    expect(pruneNumberBindings(only, merged, updates)).toBeUndefined();
    expect(pruneNumberBindings(only, merged, updates, new Set(["cornerRadius"]))).toBe(only.numberBindings);
  });
});

describe("dropDanglingNumberBindings", () => {
  it("removes only bindings whose variable is unknown", () => {
    const n = node("a", { numberBindings: { cornerRadius: { variableId: "r" }, gap: { variableId: "x" } } });
    expect(dropDanglingNumberBindings(n, (id) => id === "r").numberBindings).toEqual({ cornerRadius: { variableId: "r" } });
    expect(dropDanglingNumberBindings(n, () => true)).toBe(n);
  });
});
