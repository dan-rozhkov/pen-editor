import type { UIMessage } from "ai";

export const INTERRUPTED_TOOL_ERROR = "Interrupted: the app closed before this tool finished.";

const TERMINAL_STATES = new Set(["output-available", "output-error", "output-denied"]);

function isToolPart(part: { type: string }): boolean {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function isEmptyTextPart(part: { type: string }): boolean {
  if (part.type !== "text") return false;
  const text = (part as { text?: unknown }).text;
  return typeof text !== "string" || text.trim() === "";
}

/**
 * Makes a stored history safe to send again. Pure; parts that need no change keep their identity.
 * - A tool part that never reached a terminal state (the app closed mid-turn) would make every later
 *   request fail, so it becomes an `output-error`.
 * - A `text` / `reasoning` part still marked `streaming` becomes `done`.
 * - An assistant message left with no parts, or with only empty text, is dropped.
 */
export function sanitizeStoredMessages(messages: UIMessage[]): UIMessage[] {
  const out: UIMessage[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.parts)) {
      out.push(message);
      continue;
    }
    let changed = false;
    const parts = message.parts.map((part) => {
      if (isToolPart(part)) {
        const tool = part as unknown as Record<string, unknown>;
        if (typeof tool.state === "string" && TERMINAL_STATES.has(tool.state)) return part;
        changed = true;
        const { output: _output, approval: _approval, ...rest } = tool;
        void _output;
        void _approval;
        return {
          ...rest,
          state: "output-error",
          input: "input" in tool && tool.input !== undefined ? tool.input : {},
          errorText: INTERRUPTED_TOOL_ERROR,
        } as unknown as typeof part;
      }
      if ((part.type === "text" || part.type === "reasoning") && (part as { state?: unknown }).state === "streaming") {
        changed = true;
        return { ...part, state: "done" } as typeof part;
      }
      return part;
    });
    if (message.role === "assistant" && (parts.length === 0 || parts.every(isEmptyTextPart))) continue;
    out.push(changed ? { ...message, parts } : message);
  }
  return out;
}
