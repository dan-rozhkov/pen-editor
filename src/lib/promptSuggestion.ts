import type { UIMessage } from "ai";
import { apiFetch } from "@/lib/apiBase";

// Mirrors the backend's POST /api/prompt-suggestion limits.
const MAX_TEXT_CHARS = 2000;
const MAX_MESSAGES = 12;

// localStorage kill switch, same style as `pen.rasterCache`: set to "off" to
// stop the composer from ever calling the endpoint.
const KILL_SWITCH_KEY = "pen.promptSuggestions";

export interface SuggestionMessage {
  role: "user" | "assistant";
  text: string;
}

export function promptSuggestionsDisabled(): boolean {
  try {
    return localStorage.getItem(KILL_SWITCH_KEY) === "off";
  } catch {
    return false;
  }
}

/**
 * Reduce the chat to the plain-text transcript the suggestion endpoint wants:
 * user/assistant messages only, text parts joined (tool calls, reasoning and
 * files never leave the browser), messages with no text dropped, the last 12
 * kept. A user's message keeps its head (the request itself); an assistant
 * message keeps its tail (the closing summary / question the user will answer
 * next).
 */
export function buildSuggestionMessages(messages: UIMessage[]): SuggestionMessage[] {
  const out: SuggestionMessage[] = [];
  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = msg.parts
      .flatMap((p) => (p.type === "text" && p.text ? [p.text] : []))
      .join("\n")
      .trim();
    if (!text) continue;
    out.push({
      role: msg.role,
      text:
        text.length <= MAX_TEXT_CHARS
          ? text
          : msg.role === "user"
            ? text.slice(0, MAX_TEXT_CHARS)
            : text.slice(-MAX_TEXT_CHARS),
    });
  }
  return out.slice(-MAX_MESSAGES);
}

/** Best-effort: any failure, non-OK status, abort or empty reply is `null`. */
export async function fetchPromptSuggestion(
  messages: SuggestionMessage[],
  signal?: AbortSignal,
): Promise<string | null> {
  if (messages.length === 0 || promptSuggestionsDisabled()) return null;
  try {
    const res = await apiFetch("/api/prompt-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { suggestion?: unknown };
    return typeof data.suggestion === "string" && data.suggestion.trim()
      ? data.suggestion.trim()
      : null;
  } catch {
    return null;
  }
}
