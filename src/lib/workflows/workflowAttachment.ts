// The reading half of `workflowToPrompt` (workflowMarkdown.ts): finds the
// `<workflow id="…" title="…">…</workflow>` block a user message carries when a
// workflow is attached in the composer, so the chat can show a compact card
// instead of the raw tags.

import { markdownToSteps } from "./workflowMarkdown";

export interface WorkflowAttachment {
  /** The user's own text before the block (trailing whitespace removed). */
  before: string;
  /** The workflow's id; absent in messages written before the block carried it. */
  id?: string;
  title: string;
  steps: string[];
}

const NO_STEPS_PLACEHOLDER = "(This workflow has no steps.)";
const TRAILING_BLOCK = /<workflow (?:id="([^"\n]*)" )?title="([^"\n]*)">\n([\s\S]*?)\n<\/workflow>\s*$/;

/** Splits a message into its text and a trailing workflow block; null when it has none. */
export function parseWorkflowAttachment(text: string): WorkflowAttachment | null {
  const match = TRAILING_BLOCK.exec(text);
  if (!match) return null;
  const body = match[3];
  // The first paragraph is the standing instruction; the list follows the blank line.
  const blank = body.indexOf("\n\n");
  const list = (blank === -1 ? body : body.slice(blank + 2)).trim();
  return {
    before: text.slice(0, match.index).replace(/\s+$/, ""),
    ...(match[1] ? { id: match[1] } : {}),
    title: match[2],
    steps: list === NO_STEPS_PLACEHOLDER ? [] : markdownToSteps(list),
  };
}
