// A workflow as text: a markdown numbered list, one item per step. This is the
// form the agent reads (workflow_read, an attached workflow in a chat message)
// and the form a user may paste into the editor.

import type { Workflow } from "./workflowStore";

/** A step's text on one list item: inner line breaks become spaces, blank steps are skipped. */
function stepLine(text: string): string {
  return text.replace(/\s*\n+\s*/g, " ").trim();
}

/** "1. First\n2. Second" — numbered from 1, blank steps skipped. Empty string for no steps. */
export function stepsToMarkdown(texts: readonly string[]): string {
  return texts
    .map(stepLine)
    .filter((line) => line.length > 0)
    .map((line, i) => `${i + 1}. ${line}`)
    .join("\n");
}

const LIST_ITEM = /^\s*(?:\d+[.)]|[-*+])\s+(.*)$/;

/**
 * Reads steps from markdown: every numbered (`1.`, `1)`) or bulleted (`-`, `*`, `+`)
 * item is one step, and an indented line that is not an item continues the
 * previous step. Text with no list items at all is one step per non-empty line.
 */
export function markdownToSteps(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const hasItems = lines.some((line) => LIST_ITEM.test(line));
  if (!hasItems) return lines.map((line) => line.trim()).filter((line) => line.length > 0);
  const steps: string[] = [];
  for (const line of lines) {
    const item = LIST_ITEM.exec(line);
    if (item) {
      steps.push(item[1].trim());
    } else if (line.trim() && /^\s+/.test(line) && steps.length > 0) {
      steps[steps.length - 1] = `${steps[steps.length - 1]} ${line.trim()}`;
    }
  }
  return steps.filter((step) => step.length > 0);
}

/** The block a chat message carries when the user attaches a workflow. */
export function workflowToPrompt(workflow: Pick<Workflow, "id" | "title" | "steps">): string {
  const list = stepsToMarkdown(workflow.steps.map((s) => s.text));
  // The title sits on one line inside an attribute: whitespace collapses, double quotes become single.
  const title = workflow.title.replace(/\s+/g, " ").trim().replace(/"/g, "'");
  return [
    `<workflow id="${workflow.id}" title="${title}">`,
    "Complete these steps in this order. Do not skip a step. Tell the user when each step is done.",
    "",
    list || "(This workflow has no steps.)",
    "</workflow>",
  ].join("\n");
}
