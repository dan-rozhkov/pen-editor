import type { UIMessage } from "ai";

/**
 * True when some assistant message carries an `ask_user` tool part that has no
 * output yet. The agent's turn is paused on it, so the composer should stay
 * blocked until the user answers — otherwise sending a new message strands the
 * answer (the part is no longer in the last assistant message when it resolves).
 */
export function hasPendingAskUser(messages: UIMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "assistant" &&
      m.parts.some(
        (p) =>
          (p as { type?: string }).type === "tool-ask_user" &&
          (p as { state?: string }).state !== "output-available",
      ),
  );
}
