import { beforeEach, describe, expect, it } from "vitest";
import type { Variable, VariableCollection } from "@/types/variable";
import { useVariableStore } from "@/store/variableStore";
import { useHistoryStore } from "@/store/historyStore";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { setVariables } from "@/lib/tools/setVariables";
import { defineComponent, deleteComponent } from "@/lib/tools/components";
import { batchDesign } from "@/lib/tools/batchDesign";
import { editEmbedHtml } from "@/lib/tools/editEmbedHtml";
import { BTN_HTML } from "@/lib/embedComponents/__tests__/fixtures";
import { resetWorld, parse, seedEmbed } from "@/test/componentFixtures";
import { useSceneStore } from "@/store/sceneStore";
import type { EmbedNode } from "@/types/scene";
import { assertDefined } from "@/test/assertions";

const LIB = "lib_acme";

const libVar = (id: string, name: string, value: string): Variable => ({
  id,
  name,
  type: "color",
  collectionId: "theme",
  valuesByMode: { light: value, dark: value },
  value,
  libraryId: LIB,
});
const localVar = (id: string, name: string, value: string): Variable => ({
  id,
  name,
  type: "color",
  collectionId: "theme",
  valuesByMode: { light: value, dark: value },
  value,
});
const libCollection: VariableCollection = {
  id: "col_lib",
  name: "Density",
  modes: [
    { id: "compact", name: "Compact" },
    { id: "comfy", name: "Comfy" },
  ],
  defaultModeId: "compact",
  libraryId: LIB,
};
const spacing: Variable = {
  id: "var_space",
  name: "Space",
  type: "number",
  collectionId: "col_lib",
  valuesByMode: { compact: "4", comfy: "8" },
  value: "4",
  libraryId: LIB,
};

const store = () => useVariableStore.getState();
const byId = (id: string) => store().variables.find((v) => v.id === id);

function seed(): void {
  resetWorld();
  const theme = store().collections[0];
  store().replaceAll([libVar("var_brand", "Brand", "#0055ff"), localVar("var_mine", "Mine", "#111111"), spacing], [theme, libCollection]);
  useHistoryStore.setState({ past: [], future: [] });
}

describe("variable store: library-owned items are read-only", () => {
  beforeEach(seed);

  it("keeps the libraryId flags through the bulk setters (load, undo)", () => {
    expect(byId("var_brand")?.libraryId).toBe(LIB);
    expect(store().collections.find((c) => c.id === "col_lib")?.libraryId).toBe(LIB);
  });

  it("refuses value, rename, update, move and delete of a library variable and records no history", () => {
    expect(store().setVariableModeValue("var_brand", "light", "#ff0000")).toBe(false);
    expect(store().updateVariableThemeValue("var_brand", "dark", "#ff0000")).toBe(false);
    expect(store().updateVariable("var_brand", { description: "x" })).toBe(false);
    expect(store().renameVariable("var_brand", "Other")).toMatchObject({ error: expect.stringContaining("library-owned, read-only") });
    expect(store().moveVariableToCollection("var_brand", "col_lib")).toBe(false);
    expect(store().deleteVariable("var_brand")).toBe(false);
    expect(byId("var_brand")).toMatchObject({ name: "Brand", value: "#0055ff", libraryId: LIB });
    expect(useHistoryStore.getState().past).toHaveLength(0);
  });

  it("still edits local variables, and refuses to strip or forge the flag", () => {
    expect(store().setVariableModeValue("var_mine", "light", "#222222")).toBe(true);
    expect(byId("var_mine")?.value).toBe("#222222");
    expect(store().updateVariable("var_mine", { libraryId: LIB })).toBe(false);
    expect(byId("var_mine")?.libraryId).toBeUndefined();
  });

  it("refuses collection and mode edits on a library collection", () => {
    expect(store().renameCollection("col_lib", "X")).toBe(false);
    expect(store().deleteCollection("col_lib")).toBe(false);
    expect(store().addMode("col_lib", "Roomy")).toBeNull();
    expect(store().renameMode("col_lib", "compact", "X")).toBe(false);
    expect(store().deleteMode("col_lib", "comfy")).toBe(false);
    expect(store().setDefaultMode("col_lib", "comfy")).toBe(false);
    expect(store().collections.find((c) => c.id === "col_lib")).toMatchObject({ name: "Density", defaultModeId: "compact" });
    expect(useHistoryStore.getState().past).toHaveLength(0);
  });

  it("refuses to move a local variable into a library collection or add one there", () => {
    expect(store().moveVariableToCollection("var_mine", "col_lib")).toBe(false);
    expect(store().updateVariable("var_mine", { collectionId: "col_lib" })).toBe(false);
    expect(store().addVariable({ ...localVar("var_new", "New", "#fff"), collectionId: "col_lib", valuesByMode: { compact: "1", comfy: "2" } })).toBe(false);
    expect(byId("var_new")).toBeUndefined();
  });

  it("refuses a new or renamed local variable whose CSS name is a library token's", () => {
    expect(store().addVariable(localVar("var_dupe", "brand", "#fff"))).toBe(false);
    expect(store().renameVariable("var_mine", "Brand")).toMatchObject({ error: expect.any(String) });
    expect(store().addVariable(localVar("var_ok", "Fresh", "#fff"))).toBe(true);
  });

  it("lets a local variable alias a library variable", () => {
    expect(store().setVariableModeValue("var_mine", "light", { alias: "var_brand" })).toBe(true);
    expect(byId("var_mine")?.value).toBe("#0055ff");
  });
});

describe("set_variables: library-owned items are read-only", () => {
  beforeEach(seed);

  it("returns 'library-owned, read-only' for an update of a library variable and changes nothing", async () => {
    const result = parse(await setVariables({ variables: { Brand: { value: "#ff0000" } } }));
    expect(String(result.error)).toContain("library-owned, read-only");
    expect(byId("var_brand")?.value).toBe("#0055ff");
  });

  it("refuses by id too, and a mixed call applies nothing", async () => {
    const byIdResult = parse(await setVariables({ variables: [{ id: "var_brand", value: "#ff0000" }] }));
    expect(String(byIdResult.error)).toContain("library-owned, read-only");
    const mixed = parse(await setVariables({ variables: [{ name: "Mine", value: "#999999" }, { name: "Brand", value: "#ff0000" }] }));
    expect(String(mixed.error)).toContain("library-owned, read-only");
    expect(byId("var_mine")?.value).toBe("#111111");
  });

  it("refuses adding modes to, or variables into, a library collection", async () => {
    const mode = parse(await setVariables({ collections: { Density: { modes: ["Compact", "Comfy", "Roomy"] } } }));
    expect(String(mode.error)).toContain("library-owned, read-only");
    const inCollection = parse(await setVariables({ collection: "Density", variables: { Gap: { type: "number", value: "2" } } }));
    expect(String(inCollection.error)).toContain("library-owned, read-only");
    expect(store().collections.find((c) => c.id === "col_lib")?.modes).toHaveLength(2);
  });

  it("refuses a new local token with a library token's CSS name", async () => {
    const result = parse(await setVariables({ variables: { "--brand": "#123456" } }));
    expect(String(result.error)).toContain("library-owned, read-only");
  });

  it("keeps library data when replace is true", async () => {
    const result = parse(await setVariables({ replace: true, variables: { Fresh: "#123456" } }));
    expect(result.success).toBe(true);
    expect(store().variables.map((v) => v.id).sort()).toContain("var_brand");
    expect(store().variables.some((v) => v.id === "var_mine")).toBe(false);
    expect(byId("var_brand")?.libraryId).toBe(LIB);
  });

  it("refuses a library token as deprecated.replacedBy and keeps the variable unchanged", async () => {
    const result = parse(await setVariables({ variables: { Mine: { deprecated: { replacedBy: "Brand" } } } }));
    expect(String(result.error)).toContain("belongs to another library");
    expect(byId("var_mine")?.deprecated).toBeUndefined();
  });

  it("still updates local variables", async () => {
    const result = parse(await setVariables({ variables: { Mine: { value: "#abcdef" } } }));
    expect(result.success).toBe(true);
    expect(byId("var_mine")?.value).toBe("#abcdef");
  });
});

describe("library component masters are read-only", () => {
  const libraryMeta = { key: "btn", name: "Button", variants: { kind: ["primary", "secondary"] }, library: { id: LIB, version: "1.0.0" } };

  beforeEach(() => {
    resetWorld();
    seedEmbed("master", BTN_HTML, { component: libraryMeta });
  });

  it("define_component refuses to overwrite it", async () => {
    const result = parse(await defineComponent({ key: "btn", name: "Button 2", html: BTN_HTML }));
    expect(String(result.error)).toContain("Library component; edit it in the library document");
    expect(selectComponentRegistry().get("btn")?.meta.name).toBe("Button");
  });

  it("delete_component refuses it", async () => {
    const result = parse(await deleteComponent({ key: "btn" }));
    expect(String(result.error)).toContain("Library component");
    expect(selectComponentRegistry().has("btn")).toBe(true);
  });

  it("edit_embed_html refuses an edit of the master's HTML", async () => {
    const result = parse(await editEmbedHtml({ nodeId: "master", edits: [{ oldString: "Save", newString: "Send" }] }));
    expect(String(result.error)).toContain("Library component");
    const node = useSceneStore.getState().nodesById.master as unknown as EmbedNode;
    assertDefined(node);
    expect(node.htmlContent).toContain("Save");
  });

  it("a local master of the same shape is still editable", async () => {
    resetWorld();
    seedEmbed("master", BTN_HTML, { component: { key: "btn", name: "Button" } });
    const result = parse(await defineComponent({ key: "btn", name: "Button 2", html: BTN_HTML }));
    expect(result.error).toBeUndefined();
  });
});

describe("batch_design: library component masters are protected", () => {
  const libraryMeta = { key: "btn", name: "Button", library: { id: LIB, version: "1.0.0" } };
  const run = async (operations: string) => parse(await batchDesign({ operations }));
  const master = () => useSceneStore.getState().nodesById.master as unknown as EmbedNode;

  beforeEach(() => {
    resetWorld();
    seedEmbed("master", BTN_HTML, { component: libraryMeta });
  });

  it("refuses to create a local master on a key a library master holds", async () => {
    const html = JSON.stringify(BTN_HTML);
    const result = await run(`m=I(document, {type: "embed", name: "Mine", htmlContent: ${html}, component: {key: "btn", name: "Mine"}})`);
    expect(String(result.error)).toContain("Library component; edit it in the library document");
    expect(Object.keys(useSceneStore.getState().nodesById)).toEqual(["master"]);
  });

  it("refuses to change or strip component.library with U()", async () => {
    const strip = await run('U("master", {component: {key: "btn", name: "Button"}})');
    expect(String(strip.error)).toContain("Library component");
    const other = await run(`U("master", {component: {key: "btn", name: "Button", library: {id: "lib_evil", version: "9.9.9"}}})`);
    expect(String(other.error)).toContain("Library component");
    expect(master().component?.library).toEqual({ id: LIB, version: "1.0.0" });
  });

  it("refuses to delete a library master with D()", async () => {
    const result = await run('D("master")');
    expect(String(result.error)).toContain("Library component");
    expect(useSceneStore.getState().nodesById.master).toBeDefined();
  });

  it("refuses to delete a frame that holds a library master", async () => {
    const st = useSceneStore.getState();
    useSceneStore.setState({
      nodesById: { ...st.nodesById, frame: { id: "frame", type: "frame", name: "F", x: 0, y: 0, width: 10, height: 10 } as never },
      parentById: { ...st.parentById, frame: null, master: "frame" },
      childrenById: { ...st.childrenById, frame: ["master"] },
      rootIds: ["frame"],
      _cachedTree: null,
    });
    const result = await run('D("frame")');
    expect(String(result.error)).toContain("Library component");
    expect(useSceneStore.getState().nodesById.frame).toBeDefined();
  });
});
