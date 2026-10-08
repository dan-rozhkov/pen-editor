import { describe, it, expect, beforeEach } from "vitest";
import { getVariables } from "@/lib/tools/getVariables";
import { setVariables } from "@/lib/tools/setVariables";
import { useVariableStore } from "@/store/variableStore";
import { resetStores, seedVariablesV2 } from "@/test/fixtures";
import { modeValuesOf } from "@/lib/variables";
import type { Variable } from "@/types/variable";

const byName = (name: string): Variable =>
  useVariableStore.getState().variables.find((v) => v.name === name) as Variable;

beforeEach(() => {
  resetStores();
});

describe("set_variables review fixes", () => {
  it("1: a metadata-only entry is a definition, never a token group", async () => {
    seedVariablesV2();
    const before = useVariableStore.getState().variables.length;
    const result = JSON.parse(
      await setVariables({ variables: { "--surface": { description: "Primary surface" } } }),
    );
    expect(result.success).toBe(true);
    const after = useVariableStore.getState().variables;
    expect(after.length).toBe(before);
    expect(byName("--surface").description).toBe("Primary surface");
    expect(after.some((v) => ["description", "scopes", "deprecated"].includes(v.name))).toBe(false);
  });

  it("1: scopes-only and deprecated-only entries are definitions too", async () => {
    seedVariablesV2();
    await setVariables({
      variables: { "--surface": { scopes: ["fill"] }, "--card": { deprecated: { note: "old" } } },
    });
    const names = useVariableStore.getState().variables.map((v) => v.name).sort();
    expect(names).toEqual(["--card", "--surface"]);
    expect(byName("--surface").scopes).toEqual(["fill"]);
  });

  it("2: bare value on a single-valued Theme variable sets every mode", async () => {
    await setVariables({ variables: { "--flat": { type: "color", value: "#111111" } } });
    expect(modeValuesOf(byName("--flat"))).toEqual({ light: "#111111", dark: "#111111" });
    const result = JSON.parse(await setVariables({ variables: { "--flat": { value: "#222222" } } }));
    expect(modeValuesOf(byName("--flat"))).toEqual({ light: "#222222", dark: "#222222" });
    expect(result.warnings).toEqual([]);
  });

  it("2: bare value on a multi-valued variable sets the default mode and warns", async () => {
    await setVariables({
      variables: { "--duo": { type: "color", valuesByMode: { light: "#111111", dark: "#999999" } } },
    });
    const result = JSON.parse(await setVariables({ variables: { "--duo": { value: "#222222" } } }));
    expect(modeValuesOf(byName("--duo"))).toEqual({ light: "#222222", dark: "#999999" });
    expect(result.warnings.length).toBe(1);
  });

  it("3: a collections-only call creates collections and modes", async () => {
    const r1 = JSON.parse(await setVariables({ collections: { Brand: { modes: ["acme", "globex"] } } }));
    expect(r1.success).toBe(true);
    expect(useVariableStore.getState().collections.find((c) => c.name === "Brand")?.modes).toHaveLength(2);
    const r2 = JSON.parse(
      await setVariables({ variables: {}, collections: { Brand: { modes: ["acme", "globex", "initech"] } } }),
    );
    expect(r2.success).toBe(true);
    expect(useVariableStore.getState().collections.find((c) => c.name === "Brand")?.modes).toHaveLength(3);
  });

  it("7: valuesByMode wins over value for the default mode on create and update", async () => {
    await setVariables({
      variables: { "--a": { type: "color", value: "#111111", valuesByMode: { light: "#aaaaaa", dark: "#bbbbbb" } } },
    });
    expect(modeValuesOf(byName("--a"))).toEqual({ light: "#aaaaaa", dark: "#bbbbbb" });
    await setVariables({
      variables: { "--a": { value: "#222222", valuesByMode: { light: "#cccccc" } } },
    });
    expect(modeValuesOf(byName("--a"))).toEqual({ light: "#cccccc", dark: "#bbbbbb" });
  });
});

describe("ambiguous names across collections (6)", () => {
  beforeEach(async () => {
    await setVariables({
      collections: { Brand: { modes: ["a"] } },
      variables: [
        { name: "--x", type: "color", value: "#111111" },
        { name: "--x", type: "color", value: "#222222", collection: "Brand" },
      ],
    });
  });

  const brandX = (): Variable =>
    useVariableStore.getState().variables.find((v) => v.name === "--x" && v.collectionId !== "theme") as Variable;
  const themeX = (): Variable =>
    useVariableStore.getState().variables.find((v) => v.name === "--x" && v.collectionId === "theme") as Variable;

  it("a plain alias to an ambiguous name is refused", async () => {
    const r = JSON.parse(await setVariables({ variables: { "--y": { type: "color", value: "$--x" } } }));
    expect(r.error).toMatch(/ambiguous/);
  });

  it("$Collection/--name picks the target", async () => {
    const r = JSON.parse(
      await setVariables({ variables: { "--y": { type: "color", value: "$Brand/--x" } } }),
    );
    expect(r.success).toBe(true);
    expect(modeValuesOf(byName("--y")).light).toEqual({ alias: brandX().id });
  });

  it("$id:<id> picks the target", async () => {
    await setVariables({ variables: { "--z": { type: "color", value: `$id:${themeX().id}` } } });
    expect(modeValuesOf(byName("--z")).light).toEqual({ alias: themeX().id });
  });

  it("a name-matched update without collection is refused when ambiguous", async () => {
    const r = JSON.parse(await setVariables({ variables: { "--x": { description: "hi" } } }));
    expect(r.error).toMatch(/ambiguous/);
    const ok = JSON.parse(
      await setVariables({ variables: { "--x": { description: "hi", collection: "Brand" } } }),
    );
    expect(ok.success).toBe(true);
    expect(brandX().description).toBe("hi");
    expect(themeX().description).toBeUndefined();
  });

  it("replacedBy accepts the qualified form", async () => {
    await setVariables({
      variables: { "--old": { type: "color", value: "#000000", deprecated: { replacedBy: "$Brand/--x" } } },
    });
    expect(byName("--old").deprecated?.replacedBy).toBe(brandX().id);
  });

  it("get_variables emits the qualified form only for ambiguous names", async () => {
    await setVariables({
      variables: [
        { name: "--y", type: "color", value: "$Brand/--x" },
        { name: "--solo", type: "color", value: "#333333" },
        { name: "--w", type: "color", value: "$--solo", deprecated: { replacedBy: "$Brand/--x" } },
      ],
    });
    const res = JSON.parse(await getVariables({ names: ["--y", "--w"] }));
    const y = res.variables.find((v: { name: string }) => v.name === "--y");
    expect(y.values.Light.raw).toBe("$Brand/--x");
    const w = res.variables.find((v: { name: string }) => v.name === "--w");
    expect(w.values.Light.raw).toBe("$--solo");
    expect(w.deprecated.replacedBy).toBe("$Brand/--x");
  });
});
