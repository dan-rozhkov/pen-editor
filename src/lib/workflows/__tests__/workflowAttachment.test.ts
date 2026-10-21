import { describe, expect, it } from "vitest";
import { parseWorkflowAttachment } from "../workflowAttachment";
import { workflowToPrompt } from "../workflowMarkdown";
import { stepsFromTexts } from "../workflowStore";

const prompt = (title: string, texts: string[]) => workflowToPrompt({ id: "wf_abc", title, steps: stepsFromTexts(texts) });

describe("parseWorkflowAttachment", () => {
  it.each([
    ["a plain workflow", "Launch", ["Open the app", "Pick a theme", "Export"]],
    ["one step", "Solo", ["Only step"]],
    ["steps with punctuation", "Q&A: <review>", ["Say \"hi\" - then wait", "1. not a nested number"]],
  ])("round-trips workflowToPrompt for %s", (_name, title, texts) => {
    const parsed = parseWorkflowAttachment(prompt(title, texts));
    expect(parsed).toEqual({ before: "", id: "wf_abc", title, steps: texts });
  });

  it("returns the user's text before the block", () => {
    const parsed = parseWorkflowAttachment(`Please do this\n\n${prompt("Launch", ["A", "B"])}`);
    expect(parsed?.before).toBe("Please do this");
    expect(parsed?.steps).toEqual(["A", "B"]);
  });

  it("still reads the old form without an id", () => {
    const parsed = parseWorkflowAttachment('hi\n\n<workflow title="Old">\nInstruction\n\n1. A\n</workflow>');
    expect(parsed).toEqual({ before: "hi", title: "Old", steps: ["A"] });
  });

  it("reads a workflow with no steps as an empty list", () => {
    expect(parseWorkflowAttachment(prompt("Empty", []))?.steps).toEqual([]);
  });

  it("turns double quotes in a title into single quotes, as workflowToPrompt does", () => {
    expect(parseWorkflowAttachment(prompt('The "big" one', ["A"]))?.title).toBe("The 'big' one");
  });

  it.each([
    ["no block", "just a message"],
    ["a block that is not last", `${prompt("X", ["A"])}\n\nand then more`],
    ["an unclosed block", '<workflow title="X">\nbody'],
  ])("returns null for %s", (_name, text) => {
    expect(parseWorkflowAttachment(text)).toBeNull();
  });
});
