export interface TextRewritePreset {
  id: string;
  label: string;
  instruction: string;
}

/**
 * One-click text-rewrite prompts for the "AI → Rewrite…" action on text nodes
 * (Figma "Rewrite this" analog). Picking a preset launches a Design Agent
 * chat naming the target node(s); the agent edits the node's text content
 * itself via its normal tools (e.g. `batch_design`) — no dedicated tool is
 * needed for this feature.
 */
export const TEXT_REWRITE_PRESETS: TextRewritePreset[] = [
  {
    id: "improve",
    label: "Improve writing",
    instruction:
      "Improve the writing — clearer and more polished — without changing its meaning.",
  },
  {
    id: "shorten",
    label: "Shorten",
    instruction:
      "Make the text more concise, cutting words while preserving its meaning.",
  },
  {
    id: "expand",
    label: "Expand",
    instruction:
      "Expand the text with more detail while keeping the same tone and meaning.",
  },
  {
    id: "fix-grammar",
    label: "Fix spelling & grammar",
    instruction:
      "Fix any spelling and grammar errors without changing the wording otherwise.",
  },
  {
    id: "tone-professional",
    label: "Make more professional",
    instruction: "Rewrite it in a more professional, formal tone.",
  },
  {
    id: "tone-friendly",
    label: "Make more friendly",
    instruction: "Rewrite it in a warmer, more casual and friendly tone.",
  },
  {
    id: "translate-english",
    label: "Translate to English",
    instruction: "Translate the text to English.",
  },
];

/**
 * Formats the chat message for a rewrite preset, naming the target text
 * node(s) by id so the agent knows exactly which node(s) to edit. Exported
 * for tests and reused by `launchTextRewriteChat`.
 */
export function buildRewriteMessage(nodeIds: string[], instruction: string): string {
  const target =
    nodeIds.length === 1
      ? `text node ${nodeIds[0]}`
      : `text nodes ${nodeIds.join(", ")}`;
  return `Rewrite the ${target}. ${instruction} Edit the node's text content in place (e.g. via batch_design) and keep all styling unchanged.`;
}
