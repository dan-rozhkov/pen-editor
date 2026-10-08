import { beforeEach, describe, expect, it } from "vitest";
import type { EmbedNode, FlatSceneNode } from "@/types/scene";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore } from "@/store/sceneStore";
import { applyLintFixes, buildLintInput, runDesignLint, type Finding } from "..";
import { seedDocument } from "./seededDocument";

const lintFindings = (): Finding[] => runDesignLint(buildLintInput(), {}).findings;
const forNode = (nodeId: string, rule?: string) =>
  lintFindings().filter((f) => f.nodeId === nodeId && (!rule || f.rule === rule));
const node = (id: string) => useSceneStore.getState().nodesById[id];
const html = (id: string) => (node(id) as unknown as EmbedNode).htmlContent;

beforeEach(seedDocument);

describe("applyLintFixes", () => {
  it("writes all fixes as one history step", () => {
    const before = useHistoryStore.getState().past.length;
    const result = applyLintFixes(lintFindings());
    expect(result.applied.length).toBeGreaterThan(3);
    const past = useHistoryStore.getState().past;
    expect(past).toHaveLength(before + 1);
    // The step holds the document as it was before the fixes.
    expect(past[past.length - 1].nodesById.hardcodedColor.fillBinding).toBeUndefined();
    expect(node("hardcodedColor").fillBinding).toEqual({ variableId: "v-accent" });
  });

  it("writes no history when nothing applies", () => {
    const before = useHistoryStore.getState().past.length;
    expect(applyLintFixes([]).applied).toEqual([]);
    expect(applyLintFixes(forNode("hardcodedColor").map((f) => ({ ...f, fix: undefined }))).applied).toEqual([]);
    expect(useHistoryStore.getState().past).toHaveLength(before);
  });

  it("skips a fix whose value changed since the check", () => {
    const [finding] = forNode("hardcodedColor", "hardcoded-value");
    useSceneStore.getState().updateNode("hardcodedColor", { fill: "#123456" });
    const result = applyLintFixes([finding]);
    expect(result).toEqual({ applied: [], skipped: [{ id: finding.id, reason: "stale" }] });
    expect(node("hardcodedColor").fillBinding).toBeUndefined();
  });

  it("re-validates against earlier fixes of the same run", () => {
    const [finding] = forNode("hardcodedColor", "hardcoded-value");
    const result = applyLintFixes([finding, finding]);
    expect(result.applied).toHaveLength(1);
    expect(result.skipped.map((s) => s.reason)).toEqual(["stale"]);
  });

  it("never touches a library component or a finding on another page", () => {
    const [literal] = forNode("literalEmbed", "embed-literal");
    const before = html("literalEmbed");
    useSceneStore.getState().updateNode("literalEmbed", { component: { key: "lit", name: "lit", library: { id: "lib", version: "1" } } } as Partial<FlatSceneNode>);
    expect(applyLintFixes([literal]).skipped).toEqual([{ id: literal.id, reason: "library" }]);
    expect(html("literalEmbed")).toBe(before);

    const [fixable] = forNode("hardcodedColor", "hardcoded-value");
    expect(applyLintFixes([{ ...fixable, pageId: "elsewhere" }]).skipped[0].reason).toBe("other-page");
  });

  it("applies a value-changing snap only on request", () => {
    const [snap] = forNode("offScale", "off-scale-value");
    expect(applyLintFixes([snap]).skipped[0].reason).toBe("changes-value");
    expect(node("offScale")).toMatchObject({ cornerRadius: 9 });
    expect(applyLintFixes([snap], { allowValueChanges: true }).applied).toEqual([snap.id]);
    expect(node("offScale")).toMatchObject({ cornerRadius: 8, numberBindings: { cornerRadius: { variableId: "v-radius" } } });
  });

  it("rebinds a deprecated token and keeps the literal in step", () => {
    const [finding] = forNode("deprecatedBinding", "deprecated-token");
    applyLintFixes([finding]);
    expect(node("deprecatedBinding").fillBinding).toEqual({ variableId: "v-brand" });
    expect(forNode("deprecatedBinding")).toEqual([]);
  });

  it("replaces embed literals in own markup and reconciles a stale instance", () => {
    applyLintFixes(lintFindings());
    expect(html("literalEmbed")).toContain("color:var(--accent)");
    expect(html("literalEmbed")).toContain("padding:var(--space-m)");
    expect(forNode("staleEmbed", "component-drift")).toEqual([]);
  });
});
