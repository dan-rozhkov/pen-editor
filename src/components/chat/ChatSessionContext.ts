import { createContext } from "react";

/**
 * Id of the chat session whose transcript is being rendered. Tool-result
 * widgets deep inside MessageList (e.g. the reference-image "like" button)
 * need it to write into the right per-chat store slice; parallel sessions can
 * be mounted at once so `activeChatId` alone would be wrong for a background
 * one. `null` outside a ChatPanel session (callers fall back to activeChatId).
 */
export const ChatSessionIdContext = createContext<string | null>(null);
