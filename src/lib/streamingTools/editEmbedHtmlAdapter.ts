/**
 * `StreamingToolAdapter` for `edit_embed_html` — see
 * `src/lib/tools/editEmbedHtmlProgressive.ts` for the actual re-derivation
 * logic. This module only wires that logic to the adapter shape; it is not
 * registered anywhere here (the registry that dispatches frames to adapters
 * owns that wiring).
 *
 * Design: docs/superpowers/specs/2026-09-13-streaming-tool-mutations-design.md
 */

import {
  applyStreamingEmbedHtmlEdits,
  abandonProgressiveEmbedHtmlSession,
  clearProgressiveEmbedHtmlSessions,
} from "@/lib/tools/editEmbedHtmlProgressive";
import type { StreamingToolAdapter } from "./types";

export const editEmbedHtmlAdapter: StreamingToolAdapter = {
  toolName: "edit_embed_html",

  onFrame({ sessionId, toolCallId, input }) {
    applyStreamingEmbedHtmlEdits({ sessionId, toolCallId, input });
  },

  onAbandon({ sessionId, toolCallId }) {
    abandonProgressiveEmbedHtmlSession(sessionId, toolCallId);
  },

  onSessionClear(sessionId) {
    clearProgressiveEmbedHtmlSessions(sessionId);
  },
};
