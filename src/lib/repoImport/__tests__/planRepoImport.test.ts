import { describe, it, expect, beforeEach } from "vitest";
import { planRepoImport } from "../planRepoImport";
import { useVariableStore } from "@/store/variableStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores } from "@/test/fixtures";
import { THEME_COLLECTION_ID } from "@/types/variable";
import { getVariableIndex, resolveVariable } from "@/lib/variables";
import { setVariables } from "@/lib/tools/setVariables";
import { convertDesignTokens } from "../designTokensToVariables";

const tokens = {
  colors: { background: "#ffffff", "primary.DEFAULT": "#111111" },
  dark: { colors: { background: "#000000" } },
  spacing: { "4": "1rem" },
};

function mustPlan(...args: Parameters<typeof planRepoImport>) {
  const plan = planRepoImport(...args);
  if (!plan.ok) throw new Error(plan.error);
  return plan;
}

function applyPlan(plan: ReturnType<typeof mustPlan>): void {
  useVariableStore.getState().replaceAllWithHistory(plan.next.variables, plan.next.collections);
}

function state() {
  const { variables, collections } = useVariableStore.getState();
  return { variables, collections };
}

describe("planRepoImport", () => {
  beforeEach(() => resetStores());

  it("applies Primitives and Theme aliases in a single undo step", () => {
    const { variables, collections } = state();
    const plan = mustPlan(tokens, variables, collections);
    expect(plan.preview.createCount).toBe(6);
    applyPlan(plan);

    const s = useVariableStore.getState();
    const prim = s.collections.find((c) => c.name === "Primitives");
    expect(prim?.modes.map((m) => m.name)).toEqual(["Default"]);
    const alias = s.variables.find((v) => v.name === "--background");
    expect(alias?.collectionId).toBe(THEME_COLLECTION_ID);
    const idx = getVariableIndex(s.variables, s.collections);
    const target = s.variables.find((v) => v.name === "--color-background")!;
    expect(resolveVariable(idx, alias!.id, { [THEME_COLLECTION_ID]: "light" })).toMatchObject({ ok: true, value: "#ffffff" });
    expect(resolveVariable(idx, alias!.id, { [THEME_COLLECTION_ID]: "dark" })).toMatchObject({ ok: true, value: "#000000" });
    expect(target.type).toBe("color");
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });

  it("matches what set_variables does with the same arguments", async () => {
    const { variables, collections } = state();
    const plan = mustPlan(tokens, variables, collections);
    applyPlan(plan);
    const viaPlanner = useVariableStore.getState().variables.map((v) => v.name).sort();

    resetStores();
    const res = JSON.parse(await setVariables({ ...convertDesignTokens(tokens).args }));
    expect(res.success).toBe(true);
    expect(useVariableStore.getState().variables.map((v) => v.name).sort()).toEqual(viaPlanner);
  });

  it("never touches library-owned items and reports the clashes", () => {
    useVariableStore.setState({
      collections: [
        ...useVariableStore.getState().collections,
        { id: "lib-col", name: "Lib", libraryId: "lib1", modes: [{ id: "default", name: "Default" }], defaultModeId: "default" },
      ],
      variables: [
        { id: "lib-v", name: "--color-primary", type: "color", collectionId: "lib-col", libraryId: "lib1", valuesByMode: { default: "#abcdef" }, value: "#abcdef" },
      ],
    });
    const { variables, collections } = state();
    const plan = mustPlan(tokens, variables, collections);
    expect(plan.preview.skipped.map((s) => s.name)).toEqual(expect.arrayContaining(["--color-primary", "--primary"]));
    applyPlan(plan);
    const after = useVariableStore.getState().variables;
    expect(after.find((v) => v.id === "lib-v")?.value).toBe("#abcdef");
    expect(after.some((v) => v.name === "--color-background")).toBe(true);
  });

  it("refuses the whole import when Primitives is library-owned", () => {
    useVariableStore.setState({
      collections: [
        ...useVariableStore.getState().collections,
        { id: "p", name: "Primitives", libraryId: "lib1", modes: [{ id: "default", name: "Default" }], defaultModeId: "default" },
      ],
    });
    const { variables, collections } = state();
    const plan = planRepoImport(tokens, variables, collections);
    expect(plan.ok).toBe(false);
  });

  it("overwrites local Primitives on re-import but keeps existing Theme variables", () => {
    const first = mustPlan(tokens, [], useVariableStore.getState().collections);
    applyPlan(first);
    const { variables, collections } = state();
    const second = mustPlan(tokens, variables, collections);
    expect(second.preview.overwrites).toContain("--color-background");
    expect(second.preview.skipped.some((s) => s.name === "--background" && s.reason.includes("kept"))).toBe(true);
    applyPlan(second);
    expect(useVariableStore.getState().variables).toHaveLength(variables.length);
  });

  it("reports a name that already lives in another collection", () => {
    useVariableStore.setState({
      variables: [{ id: "x", name: "--color-background", type: "color", valuesByMode: { light: "#123456", dark: "#123456" }, value: "#123456" }],
    });
    const { variables, collections } = state();
    const plan = mustPlan(tokens, variables, collections);
    expect(plan.preview.skipped.some((s) => s.name === "--color-background" && s.reason.includes("Theme"))).toBe(true);
    // its Theme alias has nothing to point at
    expect(plan.preview.skipped.some((s) => s.name === "--background")).toBe(true);
  });

  it("addresses a renamed Theme collection by id", () => {
    useVariableStore.setState({
      collections: useVariableStore.getState().collections.map((c) => (c.id === THEME_COLLECTION_ID ? { ...c, name: "Semantic" } : c)),
    });
    const { variables, collections } = state();
    const plan = mustPlan(tokens, variables, collections);
    applyPlan(plan);
    const s = useVariableStore.getState();
    expect(s.variables.find((v) => v.name === "--background")?.collectionId).toBe(THEME_COLLECTION_ID);
    expect(s.collections.filter((c) => c.name === "Theme")).toHaveLength(0);
  });

  it("updates an existing variable with the same CSS name instead of duplicating it", () => {
    const first = mustPlan(tokens, [], useVariableStore.getState().collections);
    applyPlan(first);
    // The user's copy is named without the leading dashes.
    useVariableStore.setState({
      variables: useVariableStore.getState().variables.map((v) => (v.name === "--color-background" ? { ...v, name: "color-background" } : v)),
    });
    const { variables, collections } = state();
    const plan = mustPlan(tokens, variables, collections);
    expect(plan.preview.overwrites).toContain("color-background");
    applyPlan(plan);
    const css = useVariableStore.getState().variables.filter((v) => v.name.replace(/^--/, "") === "color-background");
    expect(css).toHaveLength(1);
  });

  it("skips an overwrite that would change a variable's type", () => {
    useVariableStore.setState({
      collections: [
        ...useVariableStore.getState().collections,
        { id: "prim", name: "Primitives", modes: [{ id: "default", name: "Default" }], defaultModeId: "default" },
      ],
      variables: [{ id: "n", name: "--color-primary", type: "number", collectionId: "prim", valuesByMode: { default: "4" }, value: "4" }],
    });
    const { variables, collections } = state();
    const plan = mustPlan(tokens, variables, collections);
    expect(plan.preview.skipped.find((s) => s.name === "--color-primary")?.reason).toContain("change it to color");
    applyPlan(plan);
    expect(useVariableStore.getState().variables.find((v) => v.id === "n")?.type).toBe("number");
  });
});
