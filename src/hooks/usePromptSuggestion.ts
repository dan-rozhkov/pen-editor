import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { isOffline } from "@/lib/apiBase";
import { buildSuggestionMessages, fetchPromptSuggestion } from "@/lib/promptSuggestion";

type ChatStatus = "submitted" | "streaming" | "ready" | "error";

interface Options {
  sessionId: string;
  status: ChatStatus;
  messages: UIMessage[];
  input: string;
  /** An unanswered ask_user form blocks the composer — nothing to suggest. */
  awaitingAnswer: boolean;
  /** False while the chat is hidden or on touch layouts (no key to accept). */
  enabled?: boolean;
}

/** Quiet period "ready" must hold before fetching; tool-loop steps pass through "ready" briefly. */
const READY_DEBOUNCE_MS = 600;

function hasUnfinishedToolPart(msg: UIMessage | undefined): boolean {
  if (!msg || msg.role !== "assistant") return false;
  return msg.parts.some((p) => {
    const state = (p as { state?: string }).state;
    return (
      (p.type.startsWith("tool-") || p.type === "dynamic-tool") &&
      (state === "input-streaming" || state === "input-available")
    );
  });
}

/**
 * Predicted next user message, fetched once when a turn finishes. Fires only
 * on a live submitted/streaming -> ready transition (never on mount or for
 * restored history, never after an error), and is transient state: it is
 * dropped as soon as a new turn starts, the session changes or the component
 * unmounts. A user stop also lands on "ready"; the suggestion is then still
 * a reasonable guess, so it is not special-cased.
 */
export function usePromptSuggestion({
  sessionId,
  status,
  messages,
  input,
  awaitingAnswer,
  enabled = true,
}: Options) {
  const [state, setState] = useState<{ text: string; forId: string | undefined } | null>(null);
  const prevStatus = useRef(status);
  // Read at fire / arrival time without re-running the effect on every token
  // or keystroke.
  const latest = useRef({ messages, input, awaitingAnswer });
  useEffect(() => {
    latest.current = { messages, input, awaitingAnswer };
  }, [messages, input, awaitingAnswer]);

  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (!enabled || status !== "ready") return;
    if (was !== "submitted" && was !== "streaming") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const { messages: msgs, input: current, awaitingAnswer: waiting } = latest.current;
      const last = msgs.at(-1);
      if (last?.role !== "assistant" || waiting || current !== "" || isOffline()) return;
      if (hasUnfinishedToolPart(last)) return;
      const payload = buildSuggestionMessages(msgs);
      // A tool-only final turn is dropped from the payload; the model would
      // then answer the user's own request back to them.
      if (payload.at(-1)?.role !== "assistant") return;
      const forId = last.id;
      void fetchPromptSuggestion(payload, controller.signal).then((result) => {
        // The user may have started typing while the request was in flight.
        if (controller.signal.aborted || !result || latest.current.input !== "") return;
        setState({ text: result, forId });
      });
    }, READY_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
      setState(null);
    };
  }, [status, sessionId, enabled]);

  const dismiss = useCallback(() => setState(null), []);
  const suggestion =
    enabled && status === "ready" && state && messages.at(-1)?.id === state.forId
      ? state.text
      : null;
  return { suggestion, dismiss };
}
