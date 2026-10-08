import { beforeEach, describe, expect, it } from "vitest";
import { resetStores } from "@/test/fixtures";
import { assertDefined } from "@/test/assertions";
import { useVariableStore } from "@/store/variableStore";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { makeThemeVariable } from "@/lib/variables";
import type { Variable } from "@/types/variable";

const store = () => useVariableStore.getState();
const byId = (id: string): Variable => {
  const v = store().variables.find((x) => x.id === id);
  assertDefined(v);
  return v;
};

// Mirror the real undo cycle: snapshot current -> ask history -> restore.
function undo() {
  const prev = useHistoryStore.getState().undo(createSnapshot(useSceneStore.getState()));
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
}
function redo() {
  const next = useHistoryStore.getState().redo(createSnapshot(useSceneStore.getState()));
  if (next) useSceneStore.getState().restoreSnapshot(next);
}

beforeEach(() => {
  resetStores();
});

describe("variableStore v2", () => {
  it("starts with the Theme collection", () => {
    expect(store().collections.map((c) => c.id)).toEqual(["theme"]);
  });

  it("setVariables upgrades legacy variables and keeps the mirrors", () => {
    store().setVariables([
      { id: "p", name: "--p", type: "color", value: "#111111", themeValues: { light: "#111111", dark: "#eeeeee" } },
      { id: "r", name: "--r", type: "number", value: "8" },
    ]);
    expect(byId("p")).toMatchObject({ collectionId: "theme", valuesByMode: { light: "#111111", dark: "#eeeeee" } });
    expect(byId("r")).toMatchObject({ valuesByMode: { light: "8", dark: "8" }, themeValues: { light: "8", dark: "8" } });
  });

  it("reassigns variables with an unknown collection to Theme (pasted foreign variables)", () => {
    store().setVariables([{ id: "x", name: "x", type: "color", value: "#abc", collectionId: "ghost", valuesByMode: { m: "#abc" } }]);
    expect(byId("x").collectionId).toBe("theme");
  });

  it("updateVariableThemeValue edits one mode and re-syncs the mirrors", () => {
    store().setVariables([makeThemeVariable("c", "#111111", "#222222")]);
    const id = store().variables[0].id;
    store().updateVariableThemeValue(id, "dark", "#333333");
    expect(byId(id)).toMatchObject({ valuesByMode: { light: "#111111", dark: "#333333" }, themeValues: { light: "#111111", dark: "#333333" } });
  });

  it("legacy updateVariable({ value }) edits the default mode", () => {
    store().addVariable({ id: "v1", name: "--brand", type: "color", value: "#3366ff" });
    store().updateVariable("v1", { value: "#ff0000" });
    expect(byId("v1").value).toBe("#ff0000");
    expect(byId("v1").themeValues).toEqual({ light: "#ff0000", dark: "#ff0000" });
  });

  it("legacy updateVariable({ themeValues }) edits light and dark", () => {
    store().addVariable({ id: "v1", name: "--brand", type: "color", value: "#3366ff" });
    store().updateVariable("v1", { themeValues: { light: "#ffffff", dark: "#000000" } });
    expect(byId("v1").valuesByMode).toEqual({ light: "#ffffff", dark: "#000000" });
  });

  describe("aliases", () => {
    beforeEach(() => {
      store().setVariables([makeThemeVariable("base", "#111111", "#222222"), makeThemeVariable("top", "#000000", "#000000")]);
    });
    const ids = () => ({ base: store().variables[0].id, top: store().variables[1].id });

    it("an alias mode resolves through the target and follows its edits", () => {
      const { base, top } = ids();
      expect(store().setVariableModeValue(top, "light", { alias: base })).toBe(true);
      expect(byId(top).value).toBe("#111111");
      store().setVariableModeValue(base, "light", "#999999");
      expect(byId(top).value).toBe("#999999");
      expect(byId(top).themeValues).toEqual({ light: "#999999", dark: "#000000" });
    });

    it("rejects a cycle and a type mismatch without changing anything", () => {
      const { base, top } = ids();
      store().setVariableModeValue(top, "light", { alias: base });
      const before = store().variables;
      expect(store().setVariableModeValue(base, "dark", { alias: top })).toBe(false);
      expect(store().setVariableModeValue(base, "dark", { alias: base })).toBe(false);
      store().addVariable({ id: "n", name: "n", type: "number", value: "1" });
      const afterAdd = store().variables;
      expect(store().setVariableModeValue(top, "dark", { alias: "n" })).toBe(false);
      expect(store().variables).toBe(afterAdd);
      expect(before).not.toBe(afterAdd);
    });

    it("deleting a target rewrites its aliases to the resolved literal", () => {
      const { base, top } = ids();
      store().setVariableModeValue(top, "light", { alias: base });
      store().setVariableModeValue(top, "dark", { alias: base });
      store().deleteVariable(base);
      expect(byId(top).valuesByMode).toEqual({ light: "#111111", dark: "#222222" });
    });

    it("deleting a target drops deprecated.replacedBy pointing at it", () => {
      const { base, top } = ids();
      store().updateVariable(top, { deprecated: { replacedBy: base, since: "1" } });
      store().deleteVariable(base);
      expect(byId(top).deprecated).toEqual({ since: "1" });
    });
  });

  describe("collections and modes", () => {
    it("addCollection / addMode copy the default mode's values", () => {
      const cid = store().addCollection("Brand", ["Acme"]);
      store().addVariable({ id: "b", name: "b", type: "color", value: "#e00", collectionId: cid, valuesByMode: { [store().collections[1].modes[0].id]: "#e00" } });
      const mode = store().addMode(cid, "Globex");
      assertDefined(mode);
      expect(byId("b").valuesByMode?.[mode]).toBe("#e00");
      expect(byId("b").themeValues).toBeUndefined();
    });

    it("deleteMode refuses the default mode and drops entries otherwise", () => {
      const cid = store().addCollection("Brand", ["Acme", "Globex"]);
      const [acme, globex] = store().collections[1].modes.map((m) => m.id);
      store().addVariable({ id: "b", name: "b", type: "color", value: "#e00", collectionId: cid, valuesByMode: { [acme]: "#e00", [globex]: "#0a0" } });
      expect(store().deleteMode(cid, acme)).toBe(false);
      expect(store().deleteMode(cid, globex)).toBe(true);
      expect(byId("b").valuesByMode).toEqual({ [acme]: "#e00" });
    });

    it("setDefaultMode changes the value mirror", () => {
      const cid = store().addCollection("Brand", ["Acme", "Globex"]);
      const [acme, globex] = store().collections[1].modes.map((m) => m.id);
      store().addVariable({ id: "b", name: "b", type: "color", value: "#e00", collectionId: cid, valuesByMode: { [acme]: "#e00", [globex]: "#0a0" } });
      store().setDefaultMode(cid, globex);
      expect(byId("b").value).toBe("#0a0");
    });

    it("deleteCollection refuses Theme and non-empty collections", () => {
      const cid = store().addCollection("Brand");
      expect(store().deleteCollection("theme")).toBe(false);
      store().addVariable({ id: "b", name: "b", type: "color", value: "#e00", collectionId: cid, valuesByMode: { [store().collections[1].modes[0].id]: "#e00" } });
      expect(store().deleteCollection(cid)).toBe(false);
      store().deleteVariable("b");
      expect(store().deleteCollection(cid)).toBe(true);
      expect(store().collections.map((c) => c.id)).toEqual(["theme"]);
    });

    it("moveVariableToCollection copies the default value into every target mode", () => {
      const cid = store().addCollection("Brand", ["Acme", "Globex"]);
      store().setVariables([makeThemeVariable("c", "#111111", "#222222")]);
      const id = store().variables[0].id;
      store().moveVariableToCollection(id, cid);
      const [acme, globex] = store().collections[1].modes.map((m) => m.id);
      expect(byId(id)).toMatchObject({ collectionId: cid, valuesByMode: { [acme]: "#111111", [globex]: "#111111" } });
      expect(byId(id).themeValues).toBeUndefined();
    });
  });

  describe("history", () => {
    it("undo/redo round-trips variables AND collections", () => {
      useHistoryStore.getState().clear();
      const cid = store().addCollection("Brand", ["Acme"]);
      expect(store().collections).toHaveLength(2);
      undo();
      expect(store().collections.map((c) => c.id)).toEqual(["theme"]);
      redo();
      expect(store().collections.map((c) => c.id)).toEqual(["theme", cid]);
    });

    it("undo reverts a mode value edit", () => {
      store().setVariables([makeThemeVariable("c", "#111111", "#222222")]);
      const id = store().variables[0].id;
      store().setVariableModeValue(id, "dark", "#333333");
      undo();
      expect(byId(id).themeValues?.dark).toBe("#222222");
    });
  });
});
