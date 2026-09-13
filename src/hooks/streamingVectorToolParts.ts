import type { UIMessage } from "ai";
import { extractStreamingToolInputs } from "@/hooks/streamingToolParts";

/**
 * Partial `draw_vector` input observed mid-stream, extracted from a
 * `tool-draw_vector` UI message part while it is still `input-streaming`.
 *
 * This is now a thin, `draw_vector`-shaped wrapper over the generic
 * `extractStreamingToolInputs` — behavior (dedupe, state filter, ordering)
 * is unchanged; only the extraction plumbing moved to
 * `src/hooks/streamingToolParts.ts` so other streaming tools can reuse it.
 */
export interface StreamingVectorInput {
  toolCallId: string;
  name: string;
  commands: string;
}

const DRAW_VECTOR_TOOL_NAMES = new Set(["draw_vector"]);

/**
 * Extracts every currently-streaming `draw_vector` tool call across the
 * given messages. A `toolCallId` that appears more than once (later deltas
 * replace earlier ones in the same message, or the part reappears across a
 * re-render) is deduplicated to its last occurrence — the most complete
 * partial input seen so far.
 */
export function extractStreamingVectorInputs(
  messages: UIMessage[]
): StreamingVectorInput[] {
  const results: StreamingVectorInput[] = [];

  for (const { toolCallId, input } of extractStreamingToolInputs(
    messages,
    DRAW_VECTOR_TOOL_NAMES
  )) {
    const commands = input.commands;
    if (typeof commands !== "string") continue;

    const name = typeof input.name === "string" ? input.name : "Vector";

    results.push({ toolCallId, name, commands });
  }

  return results;
}
