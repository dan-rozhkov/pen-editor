import { beforeEach, describe, expect, it } from "vitest";
import { useVariableStore } from "@/store/variableStore";
import { resetStores, seedScene } from "@/test/fixtures";
import { token } from "@/lib/designLint/__tests__/fixtures";
import { lintDesign } from "../lintDesign";

interface Out {
  error?: string;
  hint: string;
  truncated: boolean;
  scanTruncated: boolean;
  summary: { warnings: number; scanned: { nodes: number } };
  findings: Array<{ nodeId: string; rule: string; mode?: string; fix?: unknown; fixHint?: string }>;
}

const run = async (args: Record<string, unknown> = {}): Promise<Out> => JSON.parse(await lintDesign(args));
const hardcoded = (out: Out) => out.findings.filter((f) => f.rule === "hardcoded-value").map((f) => f.nodeId);

beforeEach(() => {
  resetStores();
  seedScene();
  // rect1 is #ff0000, rect2 is #00ff00: --accent is the first in light and the second in dark.
  useVariableStore.getState().setVariables([token("v-accent", "--accent", { light: "#ff0000", dark: "#00ff00" })]);
});

describe("lint_design", () => {
  it("checks only the document's current mode by default and strips fix data", async () => {
    const out = await run();
    expect(hardcoded(out)).toEqual(["rect1"]);
    const [f] = out.findings.filter((x) => x.rule === "hardcoded-value");
    expect(f.fix).toBeUndefined();
    expect(f.fixHint).toContain("$--accent");
    expect(f.mode).toBeUndefined();
  });

  it("takes a Theme mode name or a collection-to-mode object", async () => {
    expect(hardcoded(await run({ mode: "dark" }))).toEqual(["rect2"]);
    expect(hardcoded(await run({ mode: { Theme: "Dark" } }))).toEqual(["rect2"]);
  });

  it('checks every mode context for "all" and labels the mode', async () => {
    const out = await run({ mode: "all" });
    expect(hardcoded(out).sort()).toEqual(["rect1", "rect2"]);
    expect(out.findings.filter((f) => f.rule === "hardcoded-value").map((f) => f.mode).sort()).toEqual([
      "Theme=Dark",
      "Theme=Light",
    ]);
  });

  it("answers an unknown mode with an error instead of linting another mode", async () => {
    expect((await run({ mode: "sepia" })).error).toContain("sepia");
    expect((await run({ mode: { Nope: "dark" } })).error).toContain("Nope");
  });

  it("scopes by nodeIds and filters by rules", async () => {
    const out = await run({ nodeIds: ["rect2"], mode: "dark" });
    expect(out.summary.scanned.nodes).toBe(1);
    expect(hardcoded(out)).toEqual(["rect2"]);
    expect((await run({ rules: ["contrast"] })).findings.every((f) => f.rule === "contrast")).toBe(true);
  });

  it("cuts to limit and says so in the hint", async () => {
    const out = await run({ mode: "all", limit: 1 });
    expect(out.findings).toHaveLength(1);
    expect(out.truncated).toBe(true);
    expect(out.hint).toMatch(/Showing 1 of/);
  });

  it("falls back to the default limit for null, empty and missing values", async () => {
    for (const limit of [null, "", undefined]) {
      expect((await run({ mode: "all", limit })).findings).toHaveLength(2);
    }
  });

  it("errors on empty or unknown nodeIds instead of reporting no findings", async () => {
    expect((await run({ nodeIds: [] })).error).toMatch(/nodeIds/);
    expect((await run({ nodeIds: ["rect1", "ghost"] })).error).toContain("ghost");
    expect((await run({ nodeIds: "rect1" })).error).toMatch(/nodeIds/);
  });

  it("errors on unknown rules and invalid severity, naming them", async () => {
    expect((await run({ rules: ["contrast", "nope"] })).error).toContain("nope");
    expect((await run({ severity: "fatal" })).error).toContain("fatal");
  });

  it("reports scan truncation apart from the findings cut", async () => {
    const cut = await run({ mode: "all", limit: 1 });
    expect(cut.truncated).toBe(true);
    expect(cut.scanTruncated).toBe(false);
    expect(cut.hint).not.toMatch(/scan stopped/);
  });
});
