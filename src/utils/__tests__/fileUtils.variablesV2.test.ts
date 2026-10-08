import { beforeEach, describe, expect, it } from "vitest";
import legacyDoc from "./fixtures/legacy-theme-doc.json";
import { deserializeDocument, serializeDocument, type PenDocument } from "@/utils/fileUtils";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { collectDocumentData } from "@/lib/commands/fileCommands";
import { useVariableStore } from "@/store/variableStore";
import { resetStores } from "@/test/fixtures";
import { assertDefined } from "@/test/assertions";
import { makeThemeVariable } from "@/lib/variables";
import type { Variable } from "@/types/variable";

const legacyJson = JSON.stringify(legacyDoc);
const open = (json: string) => applyOpenedDocument(deserializeDocument(json), { viewportWidth: 800, viewportHeight: 600 });
const serialize = () => {
  const d = collectDocumentData();
  return JSON.parse(serializeDocument(d.pages, d.variables, d.activeTheme, d.textStyles, d.fillStyles, d.effectStyles, d.variableCollections)) as PenDocument;
};

beforeEach(() => resetStores());

describe("document format v1.2 and the legacy migration", () => {
  it("opens a v1.1 document as a Theme collection with light/dark modes", () => {
    open(legacyJson);
    const { collections, variables } = useVariableStore.getState();
    expect(collections).toHaveLength(1);
    expect(collections[0]).toMatchObject({ id: "theme", defaultModeId: "light", modes: [{ id: "light" }, { id: "dark" }] });
    expect(variables[0]).toMatchObject({
      collectionId: "theme",
      // themeValues wins over the stale `value`
      valuesByMode: { light: "#3366ff", dark: "#99bbff" },
      value: "#3366ff",
    });
    expect(variables[1].valuesByMode).toEqual({ light: "8", dark: "8" });
  });

  it("writes version 1.2 with collections, v2 fields AND the legacy mirrors", () => {
    open(legacyJson);
    const saved = serialize();
    expect(saved.version).toBe("1.2");
    expect(saved.variableCollections?.map((c) => c.id)).toEqual(["theme"]);
    const primary = saved.variables?.[0];
    assertDefined(primary);
    expect(primary).toMatchObject({
      collectionId: "theme",
      valuesByMode: { light: "#3366ff", dark: "#99bbff" },
      value: "#3366ff",
      themeValues: { light: "#3366ff", dark: "#99bbff" },
    });
  });

  it("an old reader (only value/themeValues) still sees correct values, aliases resolved", () => {
    open(legacyJson);
    const store = useVariableStore.getState();
    const target = makeThemeVariable("--surface", "#ffffff", "#101010");
    store.setVariables([...store.variables, target]);
    const alias: Variable = {
      id: "var-alias", name: "--card", type: "color", value: "",
      collectionId: "theme", valuesByMode: { light: { alias: target.id }, dark: { alias: target.id } },
    };
    useVariableStore.getState().addVariable(alias);

    const saved = serialize();
    const oldReader = (saved.variables ?? []).find((v) => v.id === "var-alias");
    assertDefined(oldReader);
    expect(oldReader.themeValues).toEqual({ light: "#ffffff", dark: "#101010" });
    expect(oldReader.value).toBe("#ffffff");
  });

  it("round-trips: serialize -> deserialize -> serialize is stable", () => {
    open(legacyJson);
    const once = serialize();
    open(JSON.stringify(once));
    expect(serialize()).toEqual(once);
  });

  it("round-trips an extra collection and its modes", () => {
    open(legacyJson);
    const store = useVariableStore.getState();
    const cid = store.addCollection("Brand", ["Acme", "Globex"]);
    const [acme, globex] = useVariableStore.getState().collections[1].modes.map((m) => m.id);
    useVariableStore.getState().addVariable({
      id: "b", name: "--brand", type: "color", value: "", collectionId: cid, valuesByMode: { [acme]: "#e00000", [globex]: "#00aa00" },
    });
    const saved = serialize();
    resetStores();
    open(JSON.stringify(saved));
    const after = useVariableStore.getState();
    expect(after.collections.map((c) => c.id)).toEqual(["theme", cid]);
    expect(after.variables.find((v) => v.id === "b")).toMatchObject({ collectionId: cid, value: "#e00000", valuesByMode: { [acme]: "#e00000", [globex]: "#00aa00" } });
  });

  it("applyOpenedDocument migrates a DocumentData that skipped deserializeDocument", () => {
    applyOpenedDocument(
      {
        pages: [{ id: "p", name: "P", nodes: [], pageBackground: "#f5f5f5", guides: [], slideOrder: [], measurements: [], comments: [] }],
        variables: [{ id: "x", name: "--x", type: "color", value: "#123456" }],
        variableCollections: [],
        textStyles: [], fillStyles: [], effectStyles: [], activeTheme: "light",
      },
      { viewportWidth: 800, viewportHeight: 600 },
    );
    expect(useVariableStore.getState().variables[0]).toMatchObject({ collectionId: "theme", valuesByMode: { light: "#123456", dark: "#123456" } });
  });
});
