import { describe, it, expect, beforeEach } from "vitest";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { useDesignSystemScopeStore } from "@/store/designSystemScopeStore";
import { makeThemeCollection, makeThemeVariable } from "@/lib/variables";
import { resetWorld, seedEmbed, seedInactivePage } from "@/test/componentFixtures";
import { BTN_HTML } from "@/lib/embedComponents/__tests__/fixtures";
import { defineComponent } from "../components";
import { getDesignSystem } from "../getDesignSystem";
import { getVariables } from "../getVariables";
import { toolHandlers } from "@/lib/toolRegistry";

interface Result {
  collections: { name: string }[];
  modeContext: Record<string, string>;
  tokens?: { name: string; values: Record<string, { resolved: string }> }[];
  components?: {
    key: string;
    usage: { instances: number; embeds: number };
    warnings: string[];
  }[];
  scope: { saved: string | null };
  hint?: string;
}

const run = async (args: Record<string, unknown> = {}) => JSON.parse(await getDesignSystem(args)) as Result;

describe("get_design_system", () => {
  beforeEach(() => {
    resetWorld();
    useVariableStore.setState({
      collections: [makeThemeCollection()],
      variables: [makeThemeVariable("--ink", "#111111", "#eeeeee"), makeThemeVariable("--paper", "#ffffff", "#000000")],
    });
  });

  it("is registered as a client tool", () => {
    expect(toolHandlers.get_design_system).toBe(getDesignSystem);
  });

  it("reads tokens with resolved values per mode", async () => {
    const result = await run();
    expect(result.tokens?.map((t) => t.name)).toEqual(["--ink", "--paper"]);
    expect(result.tokens?.[0].values.Dark.resolved).toBe("#eeeeee");
    expect(result.components).toEqual([]);
  });

  it("limits values to one Theme mode and the include list", async () => {
    const result = await run({ mode: "dark", include: ["tokens"] });
    expect(result.modeContext.theme).toBe("dark");
    expect(result.components).toBeUndefined();
  });

  it("counts instances and embeds per component, masters and other pages included", async () => {
    await defineComponent({ key: "btn", name: "Button", html: BTN_HTML, variants: { kind: ["primary", "secondary"] } });
    const region = `<button data-c="btn" data-v-kind="primary"><span data-c-slot="label">A</span></button>`;
    seedEmbed("s1", `${region}${region}`);
    seedInactivePage("p9", "Other", { s2: region, s3: "<p>none</p>" });

    const result = await run();
    expect(result.components?.map((c) => c.key)).toEqual(["btn"]);
    expect(result.components?.[0].usage).toEqual({ instances: 3, embeds: 2 });
    expect(result.components?.[0].warnings).toEqual([]);
  });

  it("applies a saved scope from the scope store", async () => {
    useDesignSystemScopeStore.setState({ scopes: [{ id: "dsscope_1", name: "Ink only", names: ["--ink"] }] });
    const result = await run({ scope: { saved: "Ink only" } });
    expect(result.scope.saved).toBe("Ink only");
    expect(result.tokens?.map((t) => t.name)).toEqual(["--ink"]);
  });

  it("ignores wrong-typed arguments and an unknown include value like \"library\" gracefully", async () => {
    useThemeStore.setState({ modeContext: { theme: "light" } });
    const result = await run({ scope: "nope", mode: 5, include: ["bogus"], limit: "many" });
    expect(result.tokens).toHaveLength(2);
    const lib = await run({ include: ["tokens", "library"] });
    expect(lib.tokens).toHaveLength(2);
  });
});

describe("get_design_system and get_variables resolve identically", () => {
  beforeEach(() => {
    resetWorld();
    useVariableStore.setState({
      collections: [
        makeThemeCollection(),
        {
          id: "brand",
          name: "Brand",
          modes: [
            { id: "acme", name: "Acme" },
            { id: "globex", name: "Globex" },
          ],
          defaultModeId: "acme",
        },
      ],
      variables: [
        { id: "v-acc", name: "--acc", type: "color", collectionId: "brand", valuesByMode: { acme: "#aa0000", globex: "#00aa00" }, value: "#aa0000" },
        { id: "v-link", name: "--link", type: "color", valuesByMode: { light: { alias: "v-acc" }, dark: "#ffffff" }, value: "#aa0000" },
      ],
    });
  });

  const values = (tokens: { name: string; values: unknown }[]) => Object.fromEntries(tokens.map((t) => [t.name, t.values]));

  it("resolve a listed mode against the document context of the other collections", async () => {
    useThemeStore.setState({ modeContext: { theme: "light", brand: "globex" } });
    const ds = await run({ mode: "light" });
    const gv = JSON.parse(await getVariables({ mode: "light" })) as { variables: { name: string; values: unknown }[] };
    expect(values(ds.tokens ?? [])).toEqual(values(gv.variables));
    expect((ds.tokens ?? []).find((t) => t.name === "--link")?.values.Light.resolved).toBe("#00aa00");
  });

  it("agree when the mode argument names a mode in another collection", async () => {
    const args = { mode: { Brand: "globex" } };
    const ds = await run(args);
    const gv = JSON.parse(await getVariables(args)) as { variables: { name: string; values: unknown }[] };
    expect(values(ds.tokens ?? [])).toEqual(values(gv.variables));
  });
});

describe("get_design_system lint section", () => {
  beforeEach(() => {
    resetWorld();
    useVariableStore.setState({
      collections: [makeThemeCollection()],
      variables: [makeThemeVariable("--ink", "#111111", "#eeeeee")],
    });
  });

  type LintResult = { lint?: { rules: { id: string; severity: string; description: string; autoFix: boolean }[]; available: boolean; counts?: Record<string, number>; countsTruncated?: boolean } };
  const runLint = async (args: Record<string, unknown>) => JSON.parse(await getDesignSystem(args)) as LintResult;

  it("omits the lint section by default", async () => {
    expect((await runLint({})).lint).toBeUndefined();
  });

  it("returns the rule catalog without counts when lint is included", async () => {
    const { lint } = await runLint({ include: ["lint"] });
    expect(lint?.available).toBe(true);
    expect(lint?.rules.map((r) => r.id)).toContain("hardcoded-value");
    expect(lint?.rules.every((r) => ["error", "warning", "info"].includes(r.severity) && r.description.length > 0)).toBe(true);
    expect(lint?.counts).toBeDefined();
    expect(lint?.countsTruncated).toBeUndefined();
  });

  it("counts findings by rule only when lint is explicitly included", async () => {
    seedEmbed("e1", '<div style="color:#111111">Hi</div>');
    const withLint = await runLint({ include: ["tokens", "lint"] });
    expect(withLint.lint?.counts?.["embed-literal"]).toBeGreaterThan(0);
    const without = await runLint({ include: ["tokens"] });
    expect(without.lint).toBeUndefined();
  });
});
