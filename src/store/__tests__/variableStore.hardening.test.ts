import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores } from "@/test/fixtures";
import { assertDefined } from "@/test/assertions";
import { useVariableStore } from "@/store/variableStore";
import { useStyleStore } from "@/store/styleStore";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { seedScene } from "@/test/fixtures";
import { makeThemeVariable } from "@/lib/variables";
import { openDocument } from "@/lib/tools/openDocument";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import type { RectNode, SolidPaint } from "@/types/scene";
import type { Variable } from "@/types/variable";

const store = () => useVariableStore.getState();
const byId = (id: string): Variable => {
  const v = store().variables.find((x) => x.id === id);
  assertDefined(v);
  return v;
};

/** Brand collection with default = SECOND mode; returns its id and modes. */
function brand() {
  const cid = store().addCollection("Brand", ["Acme", "Globex"]);
  const col = store().collections.find((c) => c.id === cid);
  assertDefined(col);
  const [acme, globex] = col.modes.map((m) => m.id);
  store().setDefaultMode(cid, globex);
  return { cid, acme, globex };
}

beforeEach(() => resetStores());

describe("openDocument 'new'", () => {
  it("resets collections to the Theme-only default", async () => {
    store().addCollection("Brand", ["A", "B"]);
    expect(store().collections).toHaveLength(2);
    await openDocument({ filePathOrTemplate: "new" });
    expect(store().collections.map((c) => c.id)).toEqual(["theme"]);
    expect(store().variables).toEqual([]);
  });
});

describe("non-Theme collection resolves with store collections in detach-freeze", () => {
  it("styleStore detach freezes the DEFAULT (second) mode value of a Brand variable", () => {
    seedScene();
    const { cid, acme, globex } = brand();
    store().setVariables([
      { id: "vb", name: "--vb", type: "color", collectionId: cid, valuesByMode: { [acme]: "#111111", [globex]: "#222222" }, value: "" },
    ]);
    useStyleStore.setState({
      fillStyles: [{ id: "fs", name: "B", paint: { id: "sp", type: "solid", color: "#000000", colorBinding: { variableId: "vb" } } }],
    });
    useThemeStore.getState().setActiveTheme("light");
    useStyleStore.getState().applyFillStyleToNode("rect1", "fs");
    const node = () => useSceneStore.getState().nodesById["rect1"] as unknown as RectNode;
    const paintId = node().fills![0].id;
    useStyleStore.getState().detachFillStyleFromPaint("rect1", paintId);
    expect((node().fills![0] as SolidPaint).color).toBe("#222222");
  });
});

describe("updateVariableThemeValue on a non-Theme collection", () => {
  it("maps light to the default mode and dark to the first non-default mode", () => {
    const { cid, acme, globex } = brand();
    store().setVariables([
      { id: "vb", name: "--vb", type: "color", collectionId: cid, valuesByMode: { [acme]: "#111111", [globex]: "#222222" }, value: "" },
    ]);
    expect(store().updateVariableThemeValue("vb", "light", "#aaaaaa")).toBe(true);
    expect(byId("vb").valuesByMode?.[globex]).toBe("#aaaaaa");
    expect(store().updateVariableThemeValue("vb", "dark", "#bbbbbb")).toBe(true);
    expect(byId("vb").valuesByMode?.[acme]).toBe("#bbbbbb");
  });

  it("dark falls back to the default mode when the collection has one mode", () => {
    const cid = store().addCollection("Solo", ["Only"]);
    const only = store().collections.find((c) => c.id === cid)!.modes[0].id;
    store().setVariables([{ id: "vs", name: "--vs", type: "color", collectionId: cid, valuesByMode: { [only]: "#111111" }, value: "" }]);
    expect(store().updateVariableThemeValue("vs", "dark", "#999999")).toBe(true);
    expect(byId("vs").valuesByMode?.[only]).toBe("#999999");
  });

  it("returns false for an unknown id", () => {
    expect(store().updateVariableThemeValue("nope", "light", "#000000")).toBe(false);
  });

  it("still edits Theme variables", () => {
    store().addVariable(makeThemeVariable("--p", "#111111", "#222222"));
    const id = store().variables[0].id;
    expect(store().updateVariableThemeValue(id, "dark", "#333333")).toBe(true);
    expect(byId(id).themeValues?.dark).toBe("#333333");
  });
});

describe("updateVariable validation", () => {
  const setup = () => {
    store().setVariables([
      { id: "a", name: "--a", type: "color", value: "#111111", themeValues: { light: "#111111", dark: "#222222" } },
      { id: "b", name: "--b", type: "color", value: "#333333", themeValues: { light: "#333333", dark: "#444444" } },
      { id: "n", name: "--n", type: "number", value: "4" },
    ]);
  };

  it("rejects a valuesByMode patch that creates a cycle", () => {
    setup();
    expect(store().setVariableModeValue("b", "light", { alias: "a" })).toBe(true);
    expect(store().updateVariable("a", { valuesByMode: { light: { alias: "b" }, dark: "#222222" } })).toBe(false);
    expect(byId("a").valuesByMode?.light).toBe("#111111");
  });

  it("rejects a self alias", () => {
    setup();
    expect(store().updateVariable("a", { valuesByMode: { light: { alias: "a" }, dark: "#222222" } })).toBe(false);
  });

  it("rejects a type-mismatched alias", () => {
    setup();
    expect(store().updateVariable("a", { valuesByMode: { light: { alias: "n" }, dark: "#222222" } })).toBe(false);
    expect(byId("a").valuesByMode?.light).toBe("#111111");
  });

  it("accepts a valid alias patch", () => {
    setup();
    expect(store().updateVariable("a", { valuesByMode: { light: { alias: "b" }, dark: "#222222" } })).toBe(true);
    expect(byId("a").value).toBe("#333333");
  });

  it("rejects a type change that breaks aliases pointing at the variable", () => {
    setup();
    store().setVariableModeValue("b", "light", { alias: "a" });
    expect(store().updateVariable("a", { type: "number" })).toBe(false);
    expect(byId("a").type).toBe("color");
  });

  it("rejects a type change that contradicts the variable's own alias target", () => {
    setup();
    store().setVariableModeValue("b", "light", { alias: "a" });
    expect(store().updateVariable("b", { type: "number" })).toBe(false);
  });

  it("allows a type change for a plain variable", () => {
    setup();
    expect(store().updateVariable("a", { type: "string" })).toBe(true);
    expect(byId("a").type).toBe("string");
  });

  it("returns false for an unknown id", () => {
    setup();
    expect(store().updateVariable("zzz", { name: "x" })).toBe(false);
  });

  it("a collectionId patch goes through the move remap", () => {
    setup();
    const { cid, acme, globex } = brand();
    expect(store().updateVariable("a", { collectionId: cid })).toBe(true);
    const a = byId("a");
    expect(a.collectionId).toBe(cid);
    expect(Object.keys(a.valuesByMode ?? {}).sort()).toEqual([acme, globex].sort());
    expect(a.themeValues).toBeUndefined();
  });

  it("rejects a collectionId patch to an unknown collection", () => {
    setup();
    expect(store().updateVariable("a", { collectionId: "ghost" })).toBe(false);
    expect(byId("a").collectionId).toBe("theme");
  });

  it("plain value edits keep working", () => {
    setup();
    expect(store().updateVariable("a", { name: "--renamed", description: "d" })).toBe(true);
    expect(byId("a").name).toBe("--renamed");
  });
});

describe("applyOpenedDocument", () => {
  it("replaces variables and collections in a single store update", () => {
    const { cid, acme, globex } = brand();
    const data = {
      pages: [{ id: "p", name: "P", nodes: [], pageBackground: "#f5f5f5", guides: [], slideOrder: [], measurements: [], comments: [] }],
      variables: [{ id: "x", name: "--x", type: "color", collectionId: cid, valuesByMode: { [acme]: "#111111", [globex]: "#222222" }, value: "" }],
      variableCollections: store().collections,
      textStyles: [],
      fillStyles: [],
      effectStyles: [],
      activeTheme: "light",
    };
    resetStores();
    const listener = vi.fn();
    const unsub = useVariableStore.subscribe(listener);
    applyOpenedDocument(data as never, { viewportWidth: 800, viewportHeight: 600 });
    unsub();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(byId("x").collectionId).toBe(cid);
    expect(byId("x").valuesByMode?.[acme]).toBe("#111111");
  });
});
