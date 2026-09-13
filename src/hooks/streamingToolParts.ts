import type { UIMessage } from "ai";

/**
 * Generic extractor for partial tool input observed mid-stream, across any
 * set of tool names. Generalizes what used to be `draw_vector`-only logic in
 * `streamingVectorToolParts.ts` so other streaming-tool adapters (see
 * `src/lib/streamingTools/`) can subscribe to their own tool's frames without
 * re-implementing the AI SDK v6 part-shape/state/dedupe handling.
 *
 * Design: docs/superpowers/specs/2026-09-13-streaming-tool-mutations-design.md
 */

export interface StreamingToolInputRecord {
  toolName: string;
  toolCallId: string;
  /** Partial-JSON-parsed tool input as of this delta. Fields may be missing or truncated. */
  input: Record<string, unknown>;
}

// AI SDK v6 gives each tool call's UI part the type `tool-<toolName>`; the
// rest of the shape (state/toolCallId/input) is common across every tool, so
// there is no per-tool part interface here the way `streamingVectorToolParts`
// used to declare one.
interface GenericToolPart {
  type: string;
  state?: unknown;
  toolCallId?: unknown;
  input?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extracts every currently-streaming tool call, for the given tool names,
 * across the given messages. A `toolCallId` that appears more than once
 * (later deltas replace earlier ones in the same message, or the part
 * reappears across a re-render) is deduplicated to its last occurrence — the
 * most complete partial input seen so far. Iteration order over `messages`
 * determines the returned order, so it is stable/deterministic for a given
 * `messages` array.
 */
export function extractStreamingToolInputs(
  messages: UIMessage[],
  toolNames: ReadonlySet<string>
): StreamingToolInputRecord[] {
  const byToolCallId = new Map<string, StreamingToolInputRecord>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;

    for (const rawPart of message.parts) {
      const part = rawPart as unknown as GenericToolPart;
      if (typeof part.type !== "string" || !part.type.startsWith("tool-")) {
        continue;
      }

      const toolName = part.type.slice("tool-".length);
      if (!toolNames.has(toolName)) continue;
      if (part.state !== "input-streaming") continue;
      if (typeof part.toolCallId !== "string") continue;
      if (!isPlainObject(part.input)) continue;

      byToolCallId.set(part.toolCallId, {
        toolName,
        toolCallId: part.toolCallId,
        input: part.input,
      });
    }
  }

  return Array.from(byToolCallId.values());
}
