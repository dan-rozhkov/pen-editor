import { describe, expect, it } from "vitest";
import { markdownToSteps, stepsToMarkdown, workflowToPrompt } from "../workflowMarkdown";

describe("stepsToMarkdown", () => {
  it("numbers from 1, skips blanks and flattens newlines", () => {
    expect(stepsToMarkdown(["First", "  ", "Second\nline  two", ""])).toBe("1. First\n2. Second line  two");
    expect(stepsToMarkdown([])).toBe("");
  });
});

describe("markdownToSteps", () => {
  it.each([
    ["numbered dots", "1. a\n2. b", ["a", "b"]],
    ["numbered parens", "1) a\n2) b", ["a", "b"]],
    ["bullets", "- a\n* b\n+ c", ["a", "b", "c"]],
    ["continuation lines", "1. a\n   more\n2. b", ["a more", "b"]],
    ["plain lines", "a\n\n  b  \n", ["a", "b"]],
    ["CRLF", "1. a\r\n2. b", ["a", "b"]],
    ["empty", "", []],
  ])("%s", (_name, input, expected) => {
    expect(markdownToSteps(input)).toEqual(expected);
  });
});

describe("workflowToPrompt", () => {
  it("contains the title and the numbered list", () => {
    const prompt = workflowToPrompt({ id: "wf_1", title: 'Ship "it"', steps: [{ id: "a", text: "Build" }, { id: "b", text: "Deploy" }] });
    expect(prompt).toContain(`<workflow id="wf_1" title="Ship 'it'">`);
    expect(prompt).toContain("1. Build\n2. Deploy");
    expect(prompt.endsWith("</workflow>")).toBe(true);
  });

  it("puts a multi-line, padded title on one line", () => {
    const prompt = workflowToPrompt({ id: "wf_1", title: '  Ship\n\n  the  "app"\t ', steps: [] });
    expect(prompt.split("\n")[0]).toBe(`<workflow id="wf_1" title="Ship the 'app'">`);
  });

  it("says so when there are no steps", () => {
    expect(workflowToPrompt({ id: "wf_1", title: "T", steps: [] })).toContain("(This workflow has no steps.)");
  });
});
