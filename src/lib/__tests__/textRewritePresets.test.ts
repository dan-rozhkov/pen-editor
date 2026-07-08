import { describe, it, expect } from "vitest";
import { TEXT_REWRITE_PRESETS, buildRewriteMessage } from "@/lib/textRewritePresets";

describe("TEXT_REWRITE_PRESETS", () => {
  it("offers at least 4 presets with unique ids and labels", () => {
    expect(TEXT_REWRITE_PRESETS.length).toBeGreaterThanOrEqual(4);
    const ids = TEXT_REWRITE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of TEXT_REWRITE_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.instruction.trim().length).toBeGreaterThan(0);
    }
  });

  it("includes the required core presets", () => {
    const ids = TEXT_REWRITE_PRESETS.map((p) => p.id);
    expect(ids).toContain("improve");
    expect(ids).toContain("shorten");
    expect(ids).toContain("expand");
    expect(ids).toContain("fix-grammar");
  });
});

describe("buildRewriteMessage", () => {
  it("names a single target node by id", () => {
    const message = buildRewriteMessage(["text1"], "Make it punchier.");
    expect(message).toContain("text1");
    expect(message).toContain("Make it punchier.");
    expect(message).not.toContain(",");
  });

  it("names all target nodes when multiple are selected", () => {
    const message = buildRewriteMessage(["text1", "text2", "text3"], "Fix typos.");
    expect(message).toContain("text1");
    expect(message).toContain("text2");
    expect(message).toContain("text3");
    expect(message).toContain("Fix typos.");
  });

  it("instructs the agent to edit in place and keep styling", () => {
    const message = buildRewriteMessage(["text1"], "Improve it.");
    expect(message.toLowerCase()).toMatch(/styl/);
  });
});
