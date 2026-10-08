import { beforeEach, describe, expect, it } from "vitest";
import { batchDesign } from "@/lib/tools/batchDesign";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { resetStores } from "@/test/fixtures";
import { serializeNodeToDepth } from "@/lib/tools/serializeUtils";

type Rec = Record<string, unknown>;
const node = (id: string) => useSceneStore.getState().nodesById[id] as unknown as Rec;

async function run(operations: string) {
  const result = JSON.parse(await batchDesign({ operations }));
  expect(result.success).toBe(true);
  return result as { createdNodes: { id: string }[]; warnings?: string[]; issues?: string[] };
}
async function runRaw(operations: string) {
  return JSON.parse(await batchDesign({ operations })) as Rec;
}

beforeEach(() => {
  resetStores();
  useVariableStore.getState().setVariables([
    { id: "v-radius", name: "--radius-m", type: "number", value: "8", scopes: ["radius"] },
    { id: "v-space", name: "--space-m", type: "number", value: "16", scopes: ["spacing"] },
    { id: "v-size", name: "--size-m", type: "number", value: "120", scopes: ["size"] },
    { id: "v-font", name: "--font-m", type: "number", value: "18" },
    { id: "v-op", name: "--op-half", type: "number", value: "0.5" },
    { id: "v-stroke", name: "--stroke-m", type: "number", value: "3" },
    { id: "v-color", name: "--brand", type: "color", value: "#ff0000" },
    { id: "v-new", name: "--space-new", type: "number", value: "20" },
    { id: "v-old", name: "--space-old", type: "number", value: "4", deprecated: { replacedBy: "v-new" } },
  ]);
});

describe("batch_design $--var for numeric properties", () => {
  it("binds cornerRadius, strokeThickness, opacity", async () => {
    const r = await run(
      'a=I(document, {type: "rectangle", width: 10, height: 10, cornerRadius: "$--radius-m", strokeThickness: "$--stroke-m", opacity: "$--op-half"})',
    );
    const a = node(r.createdNodes[0].id);
    expect(a).toMatchObject({ cornerRadius: 8, strokeWidth: 3, opacity: 0.5 });
    expect(a.numberBindings).toEqual({
      cornerRadius: { variableId: "v-radius" },
      strokeWidth: { variableId: "v-stroke" },
      opacity: { variableId: "v-op" },
    });
  });

  it("binds padding (all four sides), gap, rowGap, columnGap", async () => {
    const r = await run(
      'a=I(document, {type: "frame", layout: "vertical", padding: "$--space-m", gap: "$--space-m", rowGap: "$--space-m", columnGap: "$--space-m"})',
    );
    const a = node(r.createdNodes[0].id);
    expect(a.layout).toMatchObject({ paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16, gap: 16, rowGap: 16, columnGap: 16 });
    expect(Object.keys(a.numberBindings as Rec).sort()).toEqual(
      ["columnGap", "gap", "paddingBottom", "paddingLeft", "paddingRight", "paddingTop", "rowGap"].sort(),
    );
  });

  it("binds a layout object's padding keys", async () => {
    const r = await run('a=I(document, {type: "frame", layout: {autoLayout: true, paddingLeft: "$--space-m", gap: 2}})');
    const a = node(r.createdNodes[0].id);
    expect(a.layout).toMatchObject({ paddingLeft: 16, gap: 2 });
    expect(a.numberBindings).toEqual({ paddingLeft: { variableId: "v-space" } });
  });

  it("binds width/height ($ is read before fill_container) and fixes the sizing mode", async () => {
    const r = await run('a=I(document, {type: "frame", width: "$--size-m", height: "fill_container"})');
    const a = node(r.createdNodes[0].id);
    expect(a.width).toBe(120);
    expect(a.sizing).toMatchObject({ widthMode: "fixed", heightMode: "fill_container" });
    expect(a.numberBindings).toEqual({ width: { variableId: "v-size" } });
  });

  it("binds fontSize on text", async () => {
    const r = await run('a=I(document, {type: "text", content: "Hi", fontSize: "$--font-m"})');
    const a = node(r.createdNodes[0].id);
    expect(a.fontSize).toBe(18);
    expect(a.numberBindings).toEqual({ fontSize: { variableId: "v-font" } });
  });

  it("U() with a plain number on a bound key unbinds it; other bindings stay", async () => {
    const r = await run('a=I(document, {type: "rectangle", width: 10, height: 10, cornerRadius: "$--radius-m", opacity: "$--op-half"})');
    const id = r.createdNodes[0].id;
    await run(`U(${id}, {cornerRadius: 2})`);
    expect(node(id).cornerRadius).toBe(2);
    expect(node(id).numberBindings).toEqual({ opacity: { variableId: "v-op" } });
    await run(`U(${id}, {opacity: 1})`);
    expect(node(id).numberBindings).toBeUndefined();
  });

  it("U() with $--var rebinds, and layout padding shorthand unbinds layout keys", async () => {
    const r = await run('a=I(document, {type: "frame", layout: "vertical", padding: "$--space-m"})');
    const id = r.createdNodes[0].id;
    await run(`U(${id}, {padding: 4})`);
    expect(node(id).layout).toMatchObject({ paddingTop: 4, paddingLeft: 4 });
    expect(node(id).numberBindings).toBeUndefined();
    await run(`U(${id}, {gap: "$--space-m"})`);
    expect(node(id).numberBindings).toEqual({ gap: { variableId: "v-space" } });
  });

  it("an unrelated U() keeps the bindings", async () => {
    const r = await run('a=I(document, {type: "rectangle", width: 10, height: 10, cornerRadius: "$--radius-m"})');
    const id = r.createdNodes[0].id;
    await run(`U(${id}, {x: 40, name: "Renamed"})`);
    expect(node(id).numberBindings).toEqual({ cornerRadius: { variableId: "v-radius" } });
  });

  it("warns on a non-number variable and leaves the property alone", async () => {
    const r = await run('a=I(document, {type: "rectangle", width: 10, height: 10, cornerRadius: "$--brand"})');
    const a = node(r.createdNodes[0].id);
    expect(a.numberBindings).toBeUndefined();
    expect(a.cornerRadius).toBeUndefined();
    expect(JSON.stringify(r)).toMatch(/not a number/);
  });

  it("warns (but binds) when scopes exclude the key", async () => {
    const r = await run('a=I(document, {type: "rectangle", width: 10, height: 10, cornerRadius: "$--space-m"})');
    expect(node(r.createdNodes[0].id).numberBindings).toEqual({ cornerRadius: { variableId: "v-space" } });
    expect(JSON.stringify(r)).toMatch(/scoped to \[spacing\]/);
  });

  it("warns about a deprecated variable and names the replacement", async () => {
    const r = await run('a=I(document, {type: "frame", gap: "$--space-old"})');
    expect(node(r.createdNodes[0].id).numberBindings).toEqual({ gap: { variableId: "v-old" } });
    expect(JSON.stringify(r)).toMatch(/deprecated.*--space-new/);
  });

  it("warns on an unknown variable", async () => {
    const r = await runRaw('a=I(document, {type: "rectangle", width: 10, height: 10, cornerRadius: "$--nope"})');
    expect(JSON.stringify(r)).toMatch(/not found/);
  });

  it("batch_get style serialization emits $--name, and the read round-trips", async () => {
    const r = await run('a=I(document, {type: "frame", layout: "vertical", gap: "$--space-m", cornerRadius: "$--radius-m"})');
    const id = r.createdNodes[0].id;
    const s = useSceneStore.getState();
    const out = serializeNodeToDepth(id, s.nodesById, s.childrenById, 0) as Rec;
    expect(out.cornerRadius).toBe("$--radius-m");
    expect((out.layout as Rec).gap).toBe("$--space-m");
    expect(out.numberBindings).toBeUndefined();
    // Write the read-back values onto a fresh node: bindings are recreated.
    const r2 = await run(
      `b=I(document, {type: "frame", layout: ${JSON.stringify({ autoLayout: true, gap: (out.layout as Rec).gap })}, cornerRadius: ${JSON.stringify(out.cornerRadius)}})`,
    );
    expect(node(r2.createdNodes[0].id).numberBindings).toEqual({
      gap: { variableId: "v-space" },
      cornerRadius: { variableId: "v-radius" },
    });
  });
});
