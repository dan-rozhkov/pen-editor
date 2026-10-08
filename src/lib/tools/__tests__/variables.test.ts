import { describe, it, expect, beforeEach } from "vitest";
import { getVariables } from "@/lib/tools/getVariables";
import { setVariables } from "@/lib/tools/setVariables";
import { useVariableStore } from "@/store/variableStore";
import { resetStores, seedVariables, seedVariablesV2 } from "@/test/fixtures";
import { buildVariableIndex, resolveVariable } from "@/lib/variables";
import { useThemeStore } from "@/store/themeStore";

beforeEach(() => {
  resetStores();
});

describe("get_variables", () => {
  it("returns an empty list when no variables exist", async () => {
    const result = JSON.parse(await getVariables({}));
    expect(result.variables).toEqual([]);
    expect(result.hint).toMatch(/set_variables/);
    expect(result.collections.map((c: { id: string }) => c.id)).toEqual(["theme"]);
  });

  it("serializes variables with theme values", async () => {
    seedVariables();
    const result = JSON.parse(await getVariables({}));
    expect(result.variables).toEqual([
      {
        id: "var-primary",
        name: "--primary",
        type: "color",
        value: "#3366ff",
        themeValues: { light: "#3366ff", dark: "#99bbff" },
        cssName: "--primary",
        collection: "Theme",
        values: {
          Light: { raw: "#3366ff", resolved: "#3366ff" },
          Dark: { raw: "#99bbff", resolved: "#99bbff" },
        },
      },
      {
        id: "var-radius",
        name: "--radius-m",
        type: "number",
        value: "8",
        cssName: "--radius-m",
        collection: "Theme",
        values: { Light: { raw: "8", resolved: "8" }, Dark: { raw: "8", resolved: "8" } },
      },
    ]);
    expect(result.modeContext).toEqual({ theme: "light" });
  });

  it("reports aliases as raw $name and the resolved literal per mode", async () => {
    seedVariablesV2();
    const result = JSON.parse(await getVariables({ names: ["$--card"] }));
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].values).toEqual({
      Light: { raw: "$--surface", resolved: "#ffffff" },
      Dark: { raw: "$--surface", resolved: "#101010" },
    });
  });

  it("filters by collection and names, with or without -- and $", async () => {
    seedVariablesV2();
    await setVariables({
      collections: { Brand: { modes: ["acme", "globex"] } },
      collection: "Brand",
      variables: { "--accent": { valuesByMode: { acme: "#ff0000", globex: "#00ff00" } } },
    });
    const brand = JSON.parse(await getVariables({ collection: "brand" }));
    expect(brand.variables.map((v: { name: string }) => v.name)).toEqual(["--accent"]);
    const byName = JSON.parse(await getVariables({ names: ["surface", "$--card"] }));
    expect(byName.variables.map((v: { name: string }) => v.name)).toEqual(["--surface", "--card"]);
  });

  it("limits values to the requested mode", async () => {
    seedVariablesV2();
    const dark = JSON.parse(await getVariables({ mode: "dark" }));
    for (const v of dark.variables) expect(Object.keys(v.values)).toEqual(["Dark"]);
    await setVariables({
      collections: { Brand: { modes: ["acme", "globex"] } },
      collection: "Brand",
      variables: { "--accent": { valuesByMode: { acme: "#ff0000", globex: "#00ff00" } } },
    });
    const globex = JSON.parse(await getVariables({ collection: "Brand", mode: { Brand: "globex" } }));
    expect(globex.variables[0].values).toEqual({ globex: { raw: "#00ff00", resolved: "#00ff00" } });
  });

  it("returns an empty list with a hint, not an error, when a filter matches nothing", async () => {
    seedVariables();
    const byName = JSON.parse(await getVariables({ names: ["--nope"] }));
    expect(byName.variables).toEqual([]);
    expect(byName.error).toBeUndefined();
    expect(byName.hint).toMatch(/--nope/);
    const byCollection = JSON.parse(await getVariables({ collection: "Missing" }));
    expect(byCollection.variables).toEqual([]);
    expect(byCollection.hint).toMatch(/Theme/);
  });

  it("reports description, scopes and deprecated (replacedBy as $name)", async () => {
    seedVariablesV2();
    await setVariables({
      variables: {
        "--old": { value: "#111111", description: "Legacy", scopes: ["fill"], deprecated: { since: "2.0", replacedBy: "$--surface" } },
      },
    });
    const v = JSON.parse(await getVariables({ names: ["--old"] })).variables[0];
    expect(v).toMatchObject({
      description: "Legacy",
      scopes: ["fill"],
      deprecated: { since: "2.0", replacedBy: "$--surface" },
    });
  });

  it("reports the active theme in modeContext", async () => {
    useThemeStore.setState({ activeTheme: "dark" });
    expect(JSON.parse(await getVariables({})).modeContext).toEqual({ theme: "dark" });
  });

  it("resolved values equal resolveVariable for every mode", async () => {
    seedVariablesV2();
    const { variables, collections } = useVariableStore.getState();
    const index = buildVariableIndex(variables, collections);
    const result = JSON.parse(await getVariables({}));
    for (const v of result.variables as { id: string; values: Record<string, { resolved: string }> }[]) {
      for (const [mode, expected] of [["Light", "light"], ["Dark", "dark"]] as const) {
        const r = resolveVariable(index, v.id, expected);
        expect(r.ok && v.values[mode].resolved).toBe(r.ok && r.value);
      }
    }
  });

  // The Variables panel creates variables literally named "Color 1", which is
  // not a usable custom-property name. The agent is told (system prompt,
  // "Embed variables") to reference `cssName` inside embed HTML, so this tool
  // has to report the same canonical name `canvasContext.variables` and the
  // embed injection use — otherwise the model writes `var(--Color 1)`.
  it("reports the canonical CSS name for a free-form variable name", async () => {
    useVariableStore.getState().setVariables([
      { id: "var-loose", name: "Color 1", type: "color", value: "#ff0000" },
    ]);
    const result = JSON.parse(await getVariables({}));
    expect(result.variables[0]).toMatchObject({ name: "Color 1", cssName: "--color-1" });
  });
});

describe("set_variables", () => {
  it("returns an error when no variables are provided", async () => {
    const result = JSON.parse(await setVariables({}));
    expect(result.error).toBe("No variables provided");
  });

  it("returns an error when input contains no valid definitions", async () => {
    const result = JSON.parse(await setVariables({ variables: {} }));
    expect(result.error).toBe("No valid variables found in input");
  });

  it("accepts an array of variable definitions", async () => {
    const result = JSON.parse(
      await setVariables({
        variables: [
          { name: "--accent", type: "color", value: "#ff00ff" },
        ] as unknown as Record<string, unknown>,
      })
    );
    expect(result).toMatchObject({ success: true, variableCount: 1 });

    const { variables } = useVariableStore.getState();
    expect(variables[0]).toMatchObject({
      name: "--accent",
      type: "color",
      value: "#ff00ff",
    });
    expect(variables[0].id).toBeTruthy();
  });

  it("accepts the flat name→hex shorthand and infers types", async () => {
    const result = JSON.parse(
      await setVariables({
        variables: {
          "--brand-primary": "#3b82f6",
          "--brand-bg": "#ffffff",
          "--radius-lg": "16",
        },
      })
    );
    expect(result).toMatchObject({ success: true, variableCount: 3 });

    const { variables } = useVariableStore.getState();
    expect(variables.find((v) => v.name === "--brand-primary")).toMatchObject({
      type: "color",
      value: "#3b82f6",
    });
    expect(variables.find((v) => v.name === "--radius-lg")).toMatchObject({
      type: "number",
      value: "16",
    });
  });

  it("accepts the {color} shorthand for a solid color variable", async () => {
    const result = JSON.parse(
      await setVariables({
        variables: {
          "--accent": { color: "#ff00ff" },
        },
      })
    );
    expect(result).toMatchObject({ success: true, variableCount: 1 });
    expect(useVariableStore.getState().variables[0]).toMatchObject({
      name: "--accent",
      type: "color",
      value: "#ff00ff",
    });
  });

  it("accepts nested design-token objects with $type/$value", async () => {
    const result = JSON.parse(
      await setVariables({
        variables: {
          colors: {
            "background-primary": { $type: "color", $value: "#ffffff" },
          },
          radius: {
            "radius-m": { $type: "number", $value: "8" },
          },
        },
      })
    );
    expect(result).toMatchObject({ success: true, variableCount: 2 });

    const names = useVariableStore
      .getState()
      .variables.map((v) => v.name)
      .sort();
    expect(names).toEqual(["background-primary", "radius-m"]);
  });

  it("merges by name, updating existing variables and keeping their ids", async () => {
    seedVariables();
    const result = JSON.parse(
      await setVariables({
        variables: [
          { name: "--primary", type: "color", value: "#111111" },
          { name: "--brand-new", type: "color", value: "#222222" },
        ] as unknown as Record<string, unknown>,
      })
    );
    expect(result).toMatchObject({ success: true, variableCount: 3 });

    const { variables } = useVariableStore.getState();
    const primary = variables.find((v) => v.name === "--primary");
    expect(primary?.id).toBe("var-primary"); // id preserved on merge
    expect(primary?.value).toBe("#111111");
    expect(variables.some((v) => v.name === "--brand-new")).toBe(true);
    expect(variables.some((v) => v.name === "--radius-m")).toBe(true);
  });

  it("merging a partial update (name only) preserves existing value and themeValues", async () => {
    seedVariables();
    const result = JSON.parse(
      await setVariables({
        variables: [
          { id: "var-primary", name: "--primary-renamed" },
        ] as unknown as Record<string, unknown>,
      })
    );
    expect(result).toMatchObject({ success: true, variableCount: 2 });

    const { variables } = useVariableStore.getState();
    const primary = variables.find((v) => v.id === "var-primary");
    expect(primary?.name).toBe("--primary-renamed");
    // Untouched fields must survive the merge — no clobbering with defaults.
    expect(primary?.value).toBe("#3366ff");
    expect(primary?.themeValues).toEqual({ light: "#3366ff", dark: "#99bbff" });
  });

  it("still synthesizes a valid default value for a brand-new variable with no value sent (append)", async () => {
    seedVariables();
    const result = JSON.parse(
      await setVariables({
        variables: [
          { name: "--new-radius", type: "number" },
        ] as unknown as Record<string, unknown>,
      })
    );
    expect(result).toMatchObject({ success: true, variableCount: 3 });

    const { variables } = useVariableStore.getState();
    const created = variables.find((v) => v.name === "--new-radius");
    expect(created).toMatchObject({ type: "number", value: "0" });
  });

  it("replaces the entire set when replace=true", async () => {
    seedVariables();
    const result = JSON.parse(
      await setVariables({
        variables: [
          { name: "--only", type: "color", value: "#333333" },
        ] as unknown as Record<string, unknown>,
        replace: true,
      })
    );
    expect(result).toMatchObject({ success: true, variableCount: 1 });
    expect(useVariableStore.getState().variables.map((v) => v.name)).toEqual([
      "--only",
    ]);
  });
});

describe("set_variables (tokens v2)", () => {
  const snapshot = () => JSON.stringify(useVariableStore.getState());

  it("reports created and updated names and warns when value sets the default mode only", async () => {
    seedVariables();
    const r = JSON.parse(
      await setVariables({ variables: { "--primary": "#111111", "--fresh": "#222222" } })
    );
    expect(r).toEqual({
      success: true,
      variableCount: 3,
      created: ["--fresh"],
      updated: ["--primary"],
      // Theme has two modes, so a bare `value` on an existing token is worth a note.
      warnings: [expect.stringContaining("default mode")],
    });
  });

  it("creates an alias and a forward alias inside one call", async () => {
    const r = JSON.parse(
      await setVariables({
        variables: {
          "--card": "$--surface",
          "--surface": { type: "color", value: "#ffffff", themeValues: { dark: "#101010" } },
        },
      })
    );
    expect(r.success).toBe(true);
    const { variables, collections } = useVariableStore.getState();
    const card = variables.find((v) => v.name === "--card")!;
    const surface = variables.find((v) => v.name === "--surface")!;
    expect(card.type).toBe("color");
    expect(card.valuesByMode).toEqual({ light: { alias: surface.id }, dark: { alias: surface.id } });
    const index = buildVariableIndex(variables, collections);
    expect(resolveVariable(index, card.id, "dark")).toMatchObject({ ok: true, value: "#101010" });
  });

  it("creates a collection with modes and fills per-mode values", async () => {
    const r = JSON.parse(
      await setVariables({
        collections: { Brand: { modes: ["Acme Corp", "Globex"], defaultMode: "Globex" } },
        collection: "Brand",
        variables: { "--accent": { valuesByMode: { "acme corp": "#ff0000", Globex: "#00ff00" } } },
      })
    );
    expect(r.success).toBe(true);
    const { variables, collections } = useVariableStore.getState();
    const brand = collections.find((c) => c.name === "Brand")!;
    expect(brand.modes.map((m) => m.id)).toEqual(["acme-corp", "globex"]);
    expect(brand.defaultModeId).toBe("globex");
    const accent = variables.find((v) => v.name === "--accent")!;
    expect(accent.collectionId).toBe(brand.id);
    expect(accent.valuesByMode).toEqual({ "acme-corp": "#ff0000", globex: "#00ff00" });
    expect(accent.value).toBe("#00ff00");
  });

  it("existing variable: value sets the default mode only; valuesByMode merges", async () => {
    seedVariables();
    await setVariables({ variables: { "--primary": { value: "#000001" } } });
    let p = useVariableStore.getState().variables.find((v) => v.id === "var-primary")!;
    expect(p.themeValues).toEqual({ light: "#000001", dark: "#99bbff" });
    await setVariables({ variables: { "--primary": { valuesByMode: { dark: "#000002" } } } });
    p = useVariableStore.getState().variables.find((v) => v.id === "var-primary")!;
    expect(p.themeValues).toEqual({ light: "#000001", dark: "#000002" });
  });

  it("themeValues stays a legacy alias for valuesByMode", async () => {
    await setVariables({ variables: { "--bg": { value: "#fff", themeValues: { dark: "#000" } } } });
    const bg = useVariableStore.getState().variables[0];
    expect(bg.themeValues).toEqual({ light: "#fff", dark: "#000" });
  });

  it("stores deprecation with replacedBy resolved after the whole call", async () => {
    await setVariables({
      variables: {
        "--old": { value: "#111111", deprecated: { since: "2.0", replacedBy: "$--new", note: "use new" } },
        "--new": "#222222",
      },
    });
    const { variables } = useVariableStore.getState();
    const next = variables.find((v) => v.name === "--new")!;
    expect(variables.find((v) => v.name === "--old")!.deprecated).toEqual({
      since: "2.0",
      replacedBy: next.id,
      note: "use new",
    });
  });

  it("rejects an alias cycle and changes nothing", async () => {
    seedVariablesV2();
    const before = snapshot();
    const r = JSON.parse(await setVariables({ variables: { "--surface": "$--card" } }));
    expect(r.error).toMatch(/cycle/);
    expect(snapshot()).toBe(before);
  });

  it("rejects an unknown mode, naming the variable and valid modes", async () => {
    seedVariables();
    const before = snapshot();
    const r = JSON.parse(
      await setVariables({ variables: { "--ok": "#ffffff", "--bad": { valuesByMode: { sepia: "#aa8" } } } })
    );
    expect(r.error).toMatch(/--bad.*unknown mode "sepia".*Light, Dark/);
    expect(snapshot()).toBe(before);
  });

  it("rejects an unknown per-variable collection, an unknown alias target and a type mismatch", async () => {
    seedVariables();
    const before = snapshot();
    expect(
      JSON.parse(await setVariables({ variables: { "--x": { value: "#fff", collection: "Nope" } } })).error
    ).toMatch(/unknown collection "Nope"/);
    expect(JSON.parse(await setVariables({ variables: { "--x": "$--ghost" } })).error).toMatch(/--ghost/);
    expect(
      JSON.parse(await setVariables({ variables: { "--x": { type: "color", value: "$--radius-m" } } })).error
    ).toMatch(/types differ/);
    expect(snapshot()).toBe(before);
  });

  it("rejects bad scopes and a non-object valuesByMode, naming the key", async () => {
    expect(
      JSON.parse(await setVariables({ variables: { "--x": { value: "#fff", scopes: ["bogus"] } } })).error
    ).toMatch(/scopes/);
    expect(
      JSON.parse(await setVariables({ variables: { "--x": { valuesByMode: "dark" } } })).error
    ).toMatch(/valuesByMode/);
  });

  it("adding a mode to an existing collection seeds it from the default mode", async () => {
    await setVariables({
      collections: { Brand: { modes: ["acme"] } },
      collection: "Brand",
      variables: { "--accent": "#ff0000" },
    });
    await setVariables({ collections: { Brand: { modes: ["acme", "globex"] } }, variables: { "--other": "#000000" } });
    const accent = useVariableStore.getState().variables.find((v) => v.name === "--accent")!;
    expect(accent.valuesByMode).toEqual({ acme: "#ff0000", globex: "#ff0000" });
  });

  it("refuses to change the fixed Theme modes", async () => {
    const r = JSON.parse(
      await setVariables({ collections: { Theme: { modes: ["light", "dark", "sepia"] } }, variables: { "--x": "#fff" } })
    );
    expect(r.error).toMatch(/fixed modes/);
  });
});
