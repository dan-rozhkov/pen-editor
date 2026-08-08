import type { UIMessage } from "ai";

/**
 * Partial `draw_vector` input observed mid-stream, extracted from a
 * `tool-draw_vector` UI message part while it is still `input-streaming`.
 * Pure and typed against no other tool part shape, so this stays correct
 * even as more streaming tools are added later.
 */
export interface StreamingVectorInput {
  toolCallId: string;
  name: string;
  commands: string;
}

interface PartialDrawVectorInput {
  name?: unknown;
  commands?: unknown;
}

interface DrawVectorToolPart {
  type: "tool-draw_vector";
  state: string;
  toolCallId: string;
  input?: PartialDrawVectorInput;
}

function isDrawVectorPart(
  part: UIMessage["parts"][number]
): part is UIMessage["parts"][number] & DrawVectorToolPart {
  return (part as { type?: unknown }).type === "tool-draw_vector";
}

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
  const byToolCallId = new Map<string, StreamingVectorInput>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;

    for (const part of message.parts) {
      if (!isDrawVectorPart(part)) continue;
      if (part.state !== "input-streaming") continue;

      const commands = part.input?.commands;
      if (typeof commands !== "string") continue;

      const name =
        typeof part.input?.name === "string" ? part.input.name : "Vector";

      byToolCallId.set(part.toolCallId, {
        toolCallId: part.toolCallId,
        name,
        commands,
      });
    }
  }

  return Array.from(byToolCallId.values());
}
