import { describe, expect, it } from "vitest";
import { sampleTrace } from "../__fixtures__/sampleTrace";
import { buildResultMarkdown, goalHeadline, resultDocTitle, resultText } from "../resultDoc";

describe("resultText", () => {
  it("prefers the answer, then the QA reason, else nothing", () => {
    expect(resultText(sampleTrace)).toBe("The trial button is missing on the pricing page.");
    expect(resultText({ ...sampleTrace, answer: "  " })).toBe("The pricing page has no “Start free trial” button.");
    expect(resultText({ ...sampleTrace, answer: undefined, qa: undefined })).toBe("");
  });
});

describe("goalHeadline and title", () => {
  it("takes the first line and cuts it to 60 characters", () => {
    expect(goalHeadline("First\nsecond")).toBe("First");
    expect(goalHeadline("x".repeat(80))).toBe(`${"x".repeat(59)}…`);
    expect(goalHeadline("  ")).toBe("Untitled run");
    expect(resultDocTitle({ ...sampleTrace, goal: "Check pricing\nmore" })).toBe("Result · Check pricing");
  });
});

describe("buildResultMarkdown", () => {
  it("writes a meta line, the answer and a QA section with failed checks", () => {
    const md = buildResultMarkdown(sampleTrace);
    expect(md).toBe(
      [
        "QA failed · 2025-10-09 · 9.0 s",
        "The trial button is missing on the pricing page.",
        "## QA\n**QA failed**: The pricing page has no “Start free trial” button.",
        "Failed checks:\n\n- Text “Start free trial” is visible (text not found)\n",
      ].join("\n\n"),
    );
  });

  it("leaves out the QA section for a plain run and the answer when there is none", () => {
    const md = buildResultMarkdown({ ...sampleTrace, qa: undefined, answer: "**Done**" });
    expect(md).toBe(`Done · 2025-10-09 · 9.0 s\n\n**Done**\n`);
    expect(buildResultMarkdown({ ...sampleTrace, answer: undefined })).not.toContain("The trial button is missing");
  });
});
