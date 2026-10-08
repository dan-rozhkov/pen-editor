import { beforeEach, describe, expect, it, vi } from "vitest";
import { deserializeDocument, serializeDocument, type PenDocument } from "@/utils/fileUtils";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { collectDocumentData } from "@/lib/commands/fileCommands";
import { serializePublicPenDocument } from "@/utils/publicPenExport";
import { saveEmbedDocument, restoreEmbedDocument } from "@/embed/persistence";
import { buildCanvasContext } from "@/hooks/useDesignChat";
import { getVariables } from "@/lib/tools/getVariables";
import { useThemeStore } from "@/store/themeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { resetStores } from "@/test/fixtures";
import { makeThemeCollection, makeThemeVariable } from "@/lib/variables";
import type { VariableCollection } from "@/types/variable";
import type { FlatFrameNode, SceneNode } from "@/types/scene";

const brand: VariableCollection = {
  id: "brand",
  name: "Brand",
  modes: [
    { id: "acme", name: "Acme" },
    { id: "globex", name: "Globex" },
  ],
  defaultModeId: "acme",
};

const frame = (id: string, extra: Record<string, unknown> = {}, children: SceneNode[] = []) =>
  ({ id, type: "frame", name: id, x: 0, y: 0, width: 100, height: 100, children, ...extra }) as unknown as SceneNode;

const open = (json: string) => applyOpenedDocument(deserializeDocument(json), { viewportWidth: 800, viewportHeight: 600 });
const docJson = (nodes: SceneNode[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: "1.2",
    pages: [{ id: "p1", name: "Page 1", nodes }],
    variables: [makeThemeVariable("--bg", "#fff", "#000")],
    ...extra,
  });
const nodeOf = (id: string) => useSceneStore.getState().nodesById[id] as FlatFrameNode;

beforeEach(() => resetStores());

describe("opening a document", () => {
  it("migrates a frame themeOverride into modeOverrides and drops the old key", () => {
    open(docJson([frame("f", { themeOverride: "dark" })]));
    expect(nodeOf("f").modeOverrides).toEqual({ theme: "dark" });
    expect("themeOverride" in nodeOf("f")).toBe(false);
  });

  it("prunes picks that name a deleted collection or mode", () => {
    open(docJson([frame("f", { modeOverrides: { theme: "dark", brand: "acme", ghost: "x" } })]));
    expect(nodeOf("f").modeOverrides).toEqual({ theme: "dark" });
  });

  it("restores modeContext and the activeTheme mirror", () => {
    open(docJson([], { variableCollections: [makeThemeCollection(), brand], activeTheme: "light", modeContext: { theme: "dark", brand: "globex" } }));
    expect(useThemeStore.getState().modeContext).toEqual({ theme: "dark", brand: "globex" });
    expect(useThemeStore.getState().activeTheme).toBe("dark");
  });

  it("a legacy file without modeContext shows { theme: activeTheme }", () => {
    open(docJson([], { activeTheme: "dark" }));
    expect(useThemeStore.getState().modeContext).toEqual({ theme: "dark" });
  });

  it("drops a saved pick for a mode that no longer exists", () => {
    open(docJson([], { activeTheme: "light", modeContext: { theme: "light", brand: "globex" } }));
    expect(useThemeStore.getState().modeContext).toEqual({ theme: "light" });
  });
});

describe("saving a document", () => {
  const save = () => {
    const d = collectDocumentData();
    return JSON.parse(
      serializeDocument(d.pages, d.variables, d.activeTheme, d.textStyles, d.fillStyles, d.effectStyles, d.variableCollections, d.modeContext),
    ) as PenDocument;
  };

  it("collectDocumentData carries the live modeContext", () => {
    useThemeStore.getState().setModeContext({ theme: "dark", brand: "globex" });
    expect(collectDocumentData().modeContext).toEqual({ theme: "dark", brand: "globex" });
  });

  it("round-trips modeContext through save and open", () => {
    open(docJson([], { variableCollections: [makeThemeCollection(), brand], modeContext: { theme: "dark", brand: "globex" } }));
    const saved = save();
    expect(saved.modeContext).toEqual({ theme: "dark", brand: "globex" });
    resetStores();
    open(JSON.stringify(saved));
    expect(useThemeStore.getState().modeContext).toEqual({ theme: "dark", brand: "globex" });
  });

  it("dual-writes modeOverrides and the themeOverride mirror on frames", () => {
    open(docJson([frame("f", { modeOverrides: { theme: "dark" } }, [frame("g", { themeOverride: "dark" })])]));
    const [root] = save().pages![0].nodes as unknown as Array<Record<string, unknown> & { children: Array<Record<string, unknown>> }>;
    expect(root).toMatchObject({ modeOverrides: { theme: "dark" }, themeOverride: "dark" });
    expect(root.children[0]).toMatchObject({ modeOverrides: { theme: "dark" }, themeOverride: "dark" });
  });

  it("persists modeContext through the embed autosave", () => {
    localStorage.clear();
    useThemeStore.getState().setModeContext({ theme: "dark" });
    expect(saveEmbedDocument("w")).toBe(true);
    resetStores();
    expect(useThemeStore.getState().modeContext.theme).toBe("light");
    expect(restoreEmbedDocument("w", { width: 800, height: 600 })).toBe(true);
    expect(useThemeStore.getState().modeContext.theme).toBe("dark");
  });
});

describe("public .pen export", () => {
  const children = (nodes: SceneNode[], vars = [makeThemeVariable("--bg", "#fff", "#000")], collections = [makeThemeCollection()]) =>
    JSON.parse(serializePublicPenDocument(nodes, vars, "light", collections)).children;

  it("a legacy themeOverride frame exports as before", () => {
    expect(children([frame("f", { themeOverride: "dark" })])[0].theme).toEqual({ mode: "dark" });
  });
  it("a migrated Theme pick exports identically", () => {
    expect(children([frame("f", { modeOverrides: { theme: "dark" } })])[0].theme).toEqual({ mode: "dark" });
  });
  it("other collections export on their own axis by mode name", () => {
    const out = children([frame("f", { modeOverrides: { theme: "dark", brand: "globex" } })], [makeThemeVariable("--bg", "#fff", "#000")], [makeThemeCollection(), brand]);
    expect(out[0].theme).toEqual({ mode: "dark", Brand: "Globex" });
  });
  it("a frame without overrides has no theme key", () => {
    expect("theme" in children([frame("f")])[0]).toBe(false);
  });
});

const canvasContextOf = () =>
  JSON.parse((buildCanvasContext() as { canvasContext: string }).canvasContext) as Record<string, unknown>;

describe("agent context reads the live modeContext", () => {
  it("canvasContext stays free of collections for a legacy document", () => {
    useThemeStore.getState().setActiveTheme("dark");
    const ctx = canvasContextOf();
    expect(ctx.activeTheme).toBe("dark");
    expect(ctx).not.toHaveProperty("modeContext");
    expect(ctx).not.toHaveProperty("collections");
  });

  it("canvasContext sends the document mode of every collection", () => {
    useVariableStore.getState().replaceAll([], [makeThemeCollection(), brand]);
    useThemeStore.getState().setModeContext({ theme: "dark", brand: "globex" });
    expect(canvasContextOf().modeContext).toEqual({ theme: "dark", brand: "globex" });
  });

  it("get_variables reports the live modeContext, defaulting unset collections", async () => {
    useVariableStore.getState().replaceAll([], [makeThemeCollection(), brand]);
    useThemeStore.getState().setModeContext({ theme: "dark" });
    expect(JSON.parse(await getVariables({})).modeContext).toEqual({ theme: "dark", brand: "acme" });
    useThemeStore.getState().setCollectionMode("brand", "globex");
    expect(JSON.parse(await getVariables({})).modeContext).toEqual({ theme: "dark", brand: "globex" });
  });
});

describe("converting a frame to a group", () => {
  it("drops modeOverrides along with themeOverride", () => {
    open(docJson([frame("f", { modeOverrides: { theme: "dark" } })]));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(useSceneStore.getState().convertNodeType("f")).toBe(true);
    expect("modeOverrides" in useSceneStore.getState().nodesById.f).toBe(false);
    expect("themeOverride" in useSceneStore.getState().nodesById.f).toBe(false);
  });
});
