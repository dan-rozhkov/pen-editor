import { beforeEach, describe, expect, it } from "vitest";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLintStore } from "@/store/lintStore";
import { lintDesign } from "@/lib/tools/lintDesign";
import { LINT_RULE_IDS, runDesignLint, buildLintInput } from "..";
import { SEEDED, seedDocument } from "./seededDocument";

const lintNow = () => runDesignLint(buildLintInput(), { modes: undefined, maxModes: 8 });
const idsOf = (r: { findings: Array<{ id: string }> }) => r.findings.map((f) => f.id).sort();

beforeEach(() => {
  seedDocument();
  useLintStore.setState({ mode: "current", ruleFilter: null, notice: null });
});

describe("design lint exit test", () => {
  it("finds every seeded violation and none of the near misses", () => {
    useLintStore.getState().run();
    const found = useLintStore.getState().findings;
    for (const [nodeId, rule] of Object.entries(SEEDED.violations)) {
      expect(found.some((f) => f.nodeId === nodeId && f.rule === rule), `${rule} on ${nodeId}`).toBe(true);
    }
    for (const nodeId of SEEDED.nearMisses) {
      expect(found.filter((f) => f.nodeId === nodeId), nodeId).toEqual([]);
    }
  });

  it("gives the contrast finding a fix that binds the nearest passing token", () => {
    useLintStore.getState().run();
    const f = useLintStore.getState().findings.find((x) => x.rule === "contrast" && x.nodeId === "lowContrast");
    expect(f?.fix).toMatchObject({ kind: "bind-color", variableId: "v-muted", from: "#aaaaaa" });
  });

  it("fix all leaves no hardcoded value, deprecated token, embed literal or contrast error", () => {
    const history = useHistoryStore.getState().past.length;
    useLintStore.getState().run();
    const result = useLintStore.getState().fixAll();
    expect(result.applied.length).toBeGreaterThanOrEqual(6);
    expect(useHistoryStore.getState().past.length).toBe(history + 1);

    const after = lintNow();
    const rules = new Set(after.findings.filter((f) => f.severity !== "info").map((f) => f.rule));
    expect([...rules]).toEqual([]);
    expect(after.findings.filter((f) => f.rule === "contrast" && f.severity === "error")).toEqual([]);
    // The value-changing snap waits for an explicit request.
    expect(after.findings.map((f) => f.nodeId)).toEqual(["offScale"]);

    const nodes = useSceneStore.getState().nodesById;
    expect(nodes.hardcodedColor.fillBinding).toEqual({ variableId: "v-accent" });
    expect(nodes.hardcodedRadius.numberBindings).toEqual({ cornerRadius: { variableId: "v-radius" } });
    expect(nodes.deprecatedBinding.fillBinding).toEqual({ variableId: "v-brand" });
    expect(nodes.lowContrast.fillBinding).toEqual({ variableId: "v-muted" });
    expect((nodes.literalEmbed as unknown as { htmlContent: string }).htmlContent).toContain("var(--accent)");
  });

  it("holds in every mode context after fix all", () => {
    useLintStore.getState().setMode("all");
    useLintStore.getState().fixAll();
    const after = runDesignLint(buildLintInput(), {});
    expect(after.findings.filter((f) => f.severity !== "info")).toEqual([]);
  });

  it("fixes an off-scale value only on request, and every rule id is a known one", () => {
    useLintStore.getState().run();
    expect(useLintStore.getState().fixAll("off-scale-value").applied).toHaveLength(1);
    expect(useSceneStore.getState().nodesById.offScale).toMatchObject({ cornerRadius: 8 });
    expect(useLintStore.getState().findings.every((f) => LINT_RULE_IDS.includes(f.rule))).toBe(true);
  });

  it("returns the same finding ids from the panel and from lint_design", async () => {
    useLintStore.getState().run();
    const panel = useLintStore.getState().findings.map((f) => f.id).sort();
    const tool = JSON.parse(await lintDesign({ limit: 1000 })) as { findings: Array<{ id: string }> };
    expect(tool.findings.map((f) => f.id).sort()).toEqual(panel);
    expect(panel.length).toBeGreaterThan(0);

    useLintStore.getState().setMode("all");
    const panelAll = useLintStore.getState().findings.map((f) => f.id).sort();
    const toolAll = JSON.parse(await lintDesign({ mode: "all", limit: 1000 })) as { findings: Array<{ id: string }> };
    expect(idsOf(toolAll)).toEqual(panelAll);
  });
});
