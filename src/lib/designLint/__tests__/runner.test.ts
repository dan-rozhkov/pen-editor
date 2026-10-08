import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useVariableStore } from "@/store/variableStore";
import { useSceneStore } from "@/store/sceneStore";
import { usePageStore, type PageData } from "@/store/pageStore";
import { buildLintInput, runDesignLint } from "..";
import { enumerateModeContexts } from "../context";
import { byRule, frame, lint, lintInput, rect, text, token } from "./fixtures";

const brand = token("v-brand", "--brand", "#3366ff");
const roots = [
  rect("r1", { fill: "#3366ff" }),
  text("t1", { fill: "#777777" }),
  rect("r2", { fill: "#3367ff" }),
];

describe("runDesignLint", () => {
  it("orders by severity, then rule, then scene order, and summarizes", () => {
    const r = lint(roots, { variables: [brand] });
    expect(r.findings.map((f) => [f.severity, f.rule, f.nodeId])).toEqual([
      ["error", "contrast", "t1"],
      ["warning", "hardcoded-value", "r1"],
      ["info", "off-scale-value", "r2"],
    ]);
    expect(r.summary).toMatchObject({ errors: 1, warnings: 1, info: 1, byRule: { contrast: 1, "hardcoded-value": 1, "off-scale-value": 1 } });
    expect(r.summary.scanned).toEqual({ nodes: 3, embeds: 0 });
    expect(r.truncated).toBe(false);
  });

  it("caps the list at limit but counts everything, and flags truncated", () => {
    const r = lint(roots, { variables: [brand] }, { limit: 2 });
    expect(r.findings).toHaveLength(2);
    expect(r.summary.errors + r.summary.warnings + r.summary.info).toBe(3);
    expect(r.truncated).toBe(true);
  });

  it("filters by rules and by minimum severity", () => {
    expect(lint(roots, { variables: [brand] }, { rules: ["contrast"] }).findings.map((f) => f.rule)).toEqual(["contrast"]);
    expect(lint(roots, { variables: [brand] }, { severity: "warning" }).findings.map((f) => f.severity)).toEqual(["error", "warning"]);
    expect(lint(roots, { variables: [brand] }, { severity: "error" }).summary.warnings).toBe(0);
  });

  it("scopes to subtrees and ignores unknown ids", () => {
    const tree = [frame("f", { children: [rect("in", { fill: "#3366ff" })] }), rect("out", { fill: "#3366ff" })];
    const r = lint(tree, { variables: [brand] }, { nodeIds: ["f", "ghost"] });
    expect(byRule(r, "hardcoded-value").map((f) => f.nodeId)).toEqual(["in"]);
    expect(r.summary.scanned.nodes).toBe(2);
  });

  it("gives the same ids on every run and ids differ per finding", () => {
    const a = lint(roots, { variables: [brand] });
    const b = lint(roots, { variables: [brand] });
    expect(a.findings.map((f) => f.id)).toEqual(b.findings.map((f) => f.id));
    expect(new Set(a.findings.map((f) => f.id)).size).toBe(a.findings.length);
  });

  it("stops at the node cap and at the time budget", () => {
    const many = Array.from({ length: 10 }, (_, i) => rect(`r${i}`, { fill: "#3366ff" }));
    const capped = lint(many, { variables: [brand] }, { maxNodes: 4 });
    expect(capped.summary.scanned.nodes).toBe(4);
    expect(capped.truncated).toBe(true);
    let clock = 0;
    const slow = lint(many, { variables: [brand] }, { budgetMs: 5, now: () => (clock += 10) });
    expect(slow.truncated).toBe(true);
    expect(slow.findings.length).toBeLessThan(10);
  });

  it("evaluates only the requested mode contexts", () => {
    const fg = token("fg", "--fg", { light: "#111111", dark: "#333333" });
    const bg = token("bg", "--bg", { light: "#ffffff", dark: "#000000" });
    const tree = [frame("f", { fillBinding: { variableId: "bg" }, fill: "#fff", children: [text("t", { fillBinding: { variableId: "fg" }, fill: "#111" })] })];
    expect(lint(tree, { variables: [fg, bg] }, { modes: [{ theme: "light" }] }).findings).toHaveLength(0);
    expect(lint(tree, { variables: [fg, bg] }, { modes: [{ theme: "dark" }] }).findings).toHaveLength(1);
  });

  it("returns nothing for an empty page", () => {
    const r = runDesignLint(lintInput([]));
    expect(r.findings).toEqual([]);
    expect(r.summary.scanned.nodes).toBe(0);
  });
});

describe("enumerateModeContexts", () => {
  const brandCollection = { id: "brand", name: "Brand", modes: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], defaultModeId: "a" };
  const theme = { id: "theme", name: "Theme", modes: [{ id: "light", name: "L" }, { id: "dark", name: "D" }], defaultModeId: "light" };

  it("starts at the base context and covers the product up to the cap", () => {
    const all = enumerateModeContexts([theme, brandCollection], { theme: "dark" }, 99);
    expect(all[0]).toEqual({ theme: "dark", brand: "a" });
    expect(all).toHaveLength(6);
    expect(new Set(all.map((c) => `${c.theme}/${c.brand}`)).size).toBe(6);
    expect(enumerateModeContexts([theme, brandCollection], {}, 4)).toHaveLength(4);
  });
});

describe("buildLintInput", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("snapshots the active page with absolute rects", () => {
    const input = buildLintInput();
    expect(input.rootIds).toContain("frame1");
    expect(input.rects.frame1).toMatchObject({ x: 100, y: 100, width: 400, height: 300 });
    expect(input.rects.rect1).toMatchObject({ x: 110, y: 120, width: 100, height: 50 });
    expect(input.baseModes).toEqual({ theme: "light" });
  });

  it("uses layout-computed positions inside auto-layout frames", () => {
    useSceneStore.getState().updateNode("frame1", {
      layout: { autoLayout: true, flexDirection: "column", gap: 8, paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 },
    });
    const { rects } = buildLintInput();
    expect(rects.rect1).toMatchObject({ x: 116, y: 116 });
    expect(rects.text1.y).toBe(116 + 50 + 8);
  });

  it("feeds the runner end to end", () => {
    useVariableStore.getState().setVariables([token("v-red", "--red", "#ff0000")]);
    useSceneStore.getState().updateNode("rect1", { fill: "#ff0000" });
    const r = runDesignLint(buildLintInput());
    expect(byRule(r, "hardcoded-value").map((f) => f.nodeId)).toEqual(["rect1"]);
  });

  it("captures the ancestor mode overrides of embeds on other pages", () => {
    const other = {
      id: "p2",
      name: "Other",
      nodesById: {
        outer: { id: "outer", type: "frame", modeOverrides: { theme: "dark" } },
        inner: { id: "inner", type: "frame" },
        e2: { id: "e2", type: "embed", htmlContent: "<p>x</p>" },
      },
      parentById: { outer: null, inner: "outer", e2: "inner" },
      childrenById: { outer: ["inner"], inner: ["e2"] },
      rootIds: ["outer"],
    } as unknown as PageData;
    usePageStore.setState({ pages: [...usePageStore.getState().pages, other] });
    const e2 = buildLintInput().embeds.find((e) => e.nodeId === "e2");
    expect(e2?.modeChain).toEqual([{ theme: "dark" }]);
  });
});
