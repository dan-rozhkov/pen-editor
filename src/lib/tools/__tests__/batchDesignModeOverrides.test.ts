import { beforeEach, describe, expect, it } from "vitest";
import { runBatch as run, sceneNode as node, type Rec } from "./batchDesignRun";
import { batchGet } from "@/lib/tools/batchGet";
import { setVariables } from "@/lib/tools/setVariables";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { resetStores, seedScene, seedVariables } from "@/test/fixtures";


function brandModeId(name: string): string {
  const brand = useVariableStore.getState().collections.find((c) => c.name === "Brand");
  return (brand?.modes.find((m) => m.name === name) as { id: string }).id;
}

beforeEach(async () => {
  resetStores();
  seedScene();
  seedVariables(); // --primary: light #3366ff, dark #99bbff
  await setVariables({
    collections: { Brand: { modes: ["acme", "globex"] } },
    collection: "Brand",
    variables: { "--accent": { valuesByMode: { acme: "#ff0000", globex: "#00ff00" } } },
  });
});

describe("batch_design modeOverrides", () => {
  it("accepts collection name -> mode name (case-insensitive) and stores ids", async () => {
    const r = await run('f=I(document, {type: "frame", width: 100, height: 100, modeOverrides: {"theme": "Dark", "Brand": "globex"}})');
    const f = node(r.createdNodes[0].id);
    expect(f.modeOverrides).toEqual({ theme: "dark", [useVariableStore.getState().collections.find((c) => c.name === "Brand")!.id]: brandModeId("globex") });
    expect(f.themeOverride).toBeUndefined();
  });

  it.each([
    ['theme: "dark"'],
    ['themeOverride: "dark"'],
    ['theme: {"Mode": "Dark"}'],
  ])("legacy form %s writes modeOverrides on the Theme collection and no themeOverride", async (form) => {
    const r = await run(`f=I(document, {type: "frame", width: 100, height: 100, ${form}})`);
    const f = node(r.createdNodes[0].id);
    expect(f.modeOverrides).toEqual({ theme: "dark" });
    expect(f.themeOverride).toBeUndefined();
  });

  it.each([['modeOverrides: null'], ['modeOverrides: "inherit"'], ['theme: "inherit"']])(
    "%s clears existing picks",
    async (form) => {
      const r = await run('f=I(document, {type: "frame", width: 10, height: 10, theme: "dark"})');
      const id = r.createdNodes[0].id;
      await run(`U("${id}", {${form}})`);
      expect(node(id).modeOverrides).toBeUndefined();
      expect(node(id).themeOverride).toBeUndefined();
    },
  );

  it("legacy theme shorthand keeps other collections' picks; modeOverrides replaces the set", async () => {
    const r = await run('f=I(document, {type: "frame", width: 10, height: 10, modeOverrides: {"Brand": "acme"}})');
    const id = r.createdNodes[0].id;
    await run(`U("${id}", {theme: "dark"})`);
    expect(Object.keys(node(id).modeOverrides as Rec).sort()).toHaveLength(2);
    await run(`U("${id}", {modeOverrides: {"Theme": "light"}})`);
    expect(node(id).modeOverrides).toEqual({ theme: "light" });
  });

  it("migrates a legacy themeOverride already on the frame when it is updated", async () => {
    useSceneStore.getState().updateNode("frame1", { themeOverride: "dark" } as never);
    await run('U("frame1", {modeOverrides: {"Brand": "acme"}})');
    const f = node("frame1");
    expect(f.themeOverride).toBeUndefined();
    expect(Object.keys(f.modeOverrides as Rec)).toHaveLength(1);
  });

  it("unknown collection or mode names warn and are ignored without failing", async () => {
    const r = await run('f=I(document, {type: "frame", width: 10, height: 10, modeOverrides: {"Nope": "x", "Brand": "zzz", "Theme": "dark"}})');
    const f = node(r.createdNodes[0].id);
    expect(f.modeOverrides).toEqual({ theme: "dark" });
    const text = (r.issues ?? []).join("\n");
    expect(text).toMatch(/Unknown collection "Nope"/);
    expect(text).toMatch(/Unknown mode "zzz"/);
  });

  it("an unknown legacy theme name warns and leaves the picks alone", async () => {
    const r = await run('f=I(document, {type: "frame", width: 10, height: 10, theme: "sepia"})');
    expect(node(r.createdNodes[0].id).modeOverrides).toBeUndefined();
    expect((r.issues ?? []).join("\n")).toMatch(/Unknown mode "sepia"/);
  });

  it("resolves $--var inside a dark child frame of the same insert (full inherited context)", async () => {
    const r = await run(
      'f=I(document, {type: "frame", width: 200, height: 200, modeOverrides: {"Theme": "dark", "Brand": "globex"}, children: [{type: "rect", width: 10, height: 10, fill: "$--primary"}, {type: "frame", width: 50, height: 50, children: [{type: "rect", width: 5, height: 5, fill: "$--accent"}]}]})',
    );
    const tree = useSceneStore.getState();
    const frameId = r.createdNodes[0].id;
    const [rectId, innerId] = tree.childrenById[frameId];
    expect(node(rectId).fill).toBe("#99bbff");
    expect(node(tree.childrenById[innerId][0]).fill).toBe("#00ff00");
  });

  it("a frame's own fill resolves in its parent context, not its own overrides", async () => {
    const r = await run('f=I(document, {type: "frame", width: 10, height: 10, theme: "dark", fill: "$--primary"})');
    expect(node(r.createdNodes[0].id).fill).toBe("#3366ff");
  });

  it("batch_get emits modeOverrides by name and the output round-trips into batch_design", async () => {
    const r = await run('f=I(document, {type: "frame", name: "Dark", width: 10, height: 10, modeOverrides: {"Theme": "dark", "Brand": "acme"}})');
    const id = r.createdNodes[0].id;
    const [got] = JSON.parse(await batchGet({ nodeIds: [id] })) as Rec[];
    expect(got.modeOverrides).toEqual({ Theme: "Dark", Brand: "acme" });
    expect(got.themeOverride).toBeUndefined();
    const again = await run(`g=I(document, {type: "frame", width: 10, height: 10, modeOverrides: ${JSON.stringify(got.modeOverrides)}})`);
    expect(node(again.createdNodes[0].id).modeOverrides).toEqual(node(id).modeOverrides);
  });

  it("batch_get folds a legacy themeOverride into modeOverrides by name", async () => {
    useSceneStore.getState().updateNode("frame1", { themeOverride: "dark" } as never);
    const [got] = JSON.parse(await batchGet({ nodeIds: ["frame1"] })) as Rec[];
    expect(got.modeOverrides).toEqual({ Theme: "Dark" });
    expect(got.themeOverride).toBeUndefined();
  });

  it("binds a number variable using the full inherited context, not only the Theme pick", async () => {
    await setVariables({
      collection: "Brand",
      variables: { "--pad": { type: "number", valuesByMode: { acme: "4", globex: "40" } } },
    });
    const r = await run(
      'f=I(document, {type: "frame", width: 100, height: 100, modeOverrides: {"Brand": "globex"}, children: [{type: "rect", width: 10, height: 10, cornerRadius: "$--pad"}]})',
    );
    const rectId = useSceneStore.getState().childrenById[r.createdNodes[0].id][0];
    expect(node(rectId).cornerRadius).toBe(40);
  });
});

describe("batch_design modeOverrides review fixes", () => {
  it("keeps existing picks when every entry is invalid", async () => {
    const r = await run('f=I(document, {type: "frame", width: 10, height: 10, modeOverrides: {"Theme": "dark"}})');
    const id = r.createdNodes[0].id;
    const r2 = await run(`U("${id}", {modeOverrides: {"Nope": "x", "Brand": "zzz"}})`);
    expect(node(id).modeOverrides).toEqual({ theme: "dark" });
    expect((r2.issues ?? []).join("\\n")).toMatch(/Unknown collection "Nope"/);
  });

  it("still applies the valid part of a partly invalid set (replacing the rest)", async () => {
    const r = await run('f=I(document, {type: "frame", width: 10, height: 10, modeOverrides: {"Theme": "dark"}})');
    const id = r.createdNodes[0].id;
    await run(`U("${id}", {modeOverrides: {"Nope": "x", "Brand": "acme"}})`);
    expect(Object.keys(node(id).modeOverrides as Rec)).toHaveLength(1);
  });

  it("matches names trimmed and case-insensitively, and ids", async () => {
    const brand = useVariableStore.getState().collections.find((c) => c.name === "Brand")!;
    const r = await run(`f=I(document, {type: "frame", width: 10, height: 10, modeOverrides: {"${brand.id}": "${brandModeId("globex")}", " THEME ": " Dark "}})`);
    expect(node(r.createdNodes[0].id).modeOverrides).toEqual({ theme: "dark", [brand.id]: brandModeId("globex") });
  });

  it("serializes with ids and accepts them back when two collections share a name", async () => {
    useVariableStore.setState((s) => ({
      collections: [...s.collections, { id: "brand2", name: "Brand", modes: [{ id: "m-x", name: "x" }], defaultModeId: "m-x" } as never],
    }));
    const r = await run(`f=I(document, {type: "frame", width: 10, height: 10, modeOverrides: {"brand2": "x"}})`);
    const id = r.createdNodes[0].id;
    expect(node(id).modeOverrides).toEqual({ brand2: "m-x" });
    const got = (await batchGet({ nodeIds: [id] })) as unknown as string;
    expect(String(got)).toContain('"modeOverrides":{"brand2":"x"}');
    const r2 = await run(`U("${id}", {modeOverrides: {"Brand": "acme"}})`);
    expect((r2.issues ?? []).join("\\n")).toMatch(/ambiguous/);
    expect(node(id).modeOverrides).toEqual({ brand2: "m-x" });
  });
});
