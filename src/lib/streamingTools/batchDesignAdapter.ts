/**
 * Streaming-tool adapter for `batch_design` — wires the progressive
 * ("brush by brush") applier in `src/lib/tools/batchDesign/progressive.ts`
 * into the generic `StreamingToolAdapter` registry described in
 * docs/superpowers/specs/2026-09-13-streaming-tool-mutations-design.md.
 *
 * Intentionally NOT registered here — the registry that drives
 * `onFrame`/`onAbandon`/`onSessionClear` from streamed tool-call parts
 * (`src/lib/streamingTools/index.ts`) is owned by another change in
 * flight; this module only exports the adapter object for it to wire in.
 */

import {
  applyStreamingBatchDesign,
  abandonProgressiveBatchSession,
  clearProgressiveBatchSessions,
} from "@/lib/tools/batchDesign/progressive";
import {
  createCachedOperationsParser,
  type CachedOperationsParser,
} from "@/lib/tools/batchDesign/parser";
import {
  useAiPendingScreenStore,
  pendingScreenKey,
} from "@/store/aiPendingScreenStore";
import { parsePendingScreenHeaders } from "./pendingScreenHeaders";
import { isStreamingMutationsEnabled } from "./types";
import type { StreamingToolAdapter, StreamingToolFrame, StreamingToolCallRef } from "./types";

/**
 * The backend's `batch_design` tool schema accepts a few alias argument
 * names for models that emit the wrong one (see the WebMCP contract note in
 * CLAUDE.md: "operations" is canonical, "design"/"script"/"batch" are
 * accepted aliases). That alias resolution is NOT done by the frontend
 * `batchDesign` handler (`src/lib/tools/batchDesign/index.ts`, which reads
 * only `args.operations`) — it's a `.transform()` on the backend zod schema
 * (`makeBatchDesignInputSchema` in `pen-editor-backend/src/ai/tools.ts`)
 * that runs once, server-side, against the model's FINAL, fully-validated
 * tool-call arguments, folding whichever alias key was used into
 * `operations` before the call is ever forwarded to the browser. That is
 * exactly why the frontend handler doesn't need to know the alias names.
 *
 * A streaming frame never goes through that transform: it's the partial-
 * JSON parse of a still-in-flight AI SDK v6 tool-input-streaming part, which
 * the zod schema never sees (validation is a one-shot step over the
 * complete args, not something re-run per delta). So mid-stream, before the
 * model has necessarily settled on the canonical key, this adapter has to
 * do its own best-effort alias fallback, or a model that streams `design`/
 * `script`/`batch` the whole way just never gets progressive application —
 * even though its FINAL call would resolve fine on the backend.
 */
const OPERATIONS_KEYS = ["operations", "design", "script", "batch"] as const;

function extractOperationsScript(input: Record<string, unknown>): string | undefined {
  for (const key of OPERATIONS_KEYS) {
    const value = input[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

/**
 * Per-tool-call scratch state for the placeholder/preview computation:
 * - `parser`: the cached operations parser, so the boundary scan reuses
 *   already-parsed statements across frames instead of re-running JSON5 on
 *   every one of them per frame.
 * - `completedHtml`: html strings already decoded to their closing quote
 *   (by header index). Streaming is append-only, so a closed string never
 *   changes — re-decoding it every frame (with progressive application off,
 *   that is every screen's full html) is pure waste.
 * Keyed like the pending-screen store. Dropped on abandon / session clear,
 * and swept once the store reports the call finalized (the handler finalizes
 * it directly, without going through this adapter).
 */
interface CallState {
  parser: CachedOperationsParser;
  completedHtml: Map<number, string>;
}
const callStates = new Map<string, CallState>();

function callStateFor(key: string): CallState {
  let state = callStates.get(key);
  if (!state) {
    state = { parser: createCachedOperationsParser(), completedHtml: new Map() };
    callStates.set(key, state);
  }
  return state;
}

function sweepFinalizedCallStates(): void {
  const { finalizedKeys } = useAiPendingScreenStore.getState();
  for (const key of callStates.keys()) {
    if (finalizedKeys.has(key)) callStates.delete(key);
  }
}

/**
 * Where the syntactically-complete prefix of `operations` ends — the exact
 * boundary `progressive.ts` trusts (same scanner, via the cached parser). A
 * header whose statement starts before it has already been applied as a real
 * node. Position, not count: a completed embed `I(frame1, ...)` or a header
 * skipped as malformed must not shift which placeholder is considered
 * applied. Never throws — a parse hiccup here must only cost a placeholder.
 */
function completeBoundary(state: CallState, operations: string): number {
  try {
    return state.parser.parseWithBoundary(operations).boundary;
  } catch {
    return 0;
  }
}

/**
 * Compute and stage the dashed placeholders for this frame's operations
 * string. Purely additive: called strictly after the real
 * `applyStreamingBatchDesign` call above, reads the same string it read,
 * and any failure here shows nothing rather than throwing — see this
 * module's and `pendingScreenHeaders.ts`'s doc comments for why.
 */
function updatePendingScreens(sessionId: string, toolCallId: string, operations: string): void {
  try {
    sweepFinalizedCallStates();
    const key = pendingScreenKey(sessionId, toolCallId);
    if (useAiPendingScreenStore.getState().finalizedKeys.has(key)) return;
    const state = callStateFor(key);

    // With progressive application on, headers whose statement lies inside
    // the complete prefix are already real nodes on canvas — only the ones
    // starting at/after the boundary are still "pending", and their html
    // never needs decoding. With the `pen.streamingMutations=off` kill
    // switch nothing has been applied yet, so every header needs a box.
    const boundary = isStreamingMutationsEnabled() ? completeBoundary(state, operations) : 0;
    const headers = parsePendingScreenHeaders(operations, {
      decodeFromOffset: boundary,
      completedHtml: state.completedHtml,
    });
    for (const h of headers) {
      if (h.htmlComplete && h.start >= boundary && !state.completedHtml.has(h.index)) {
        state.completedHtml.set(h.index, h.html);
      }
    }
    const screens = headers.filter((h) => h.start >= boundary);
    if (headers.length === 0) return;

    useAiPendingScreenStore.getState().upsert({ sessionId, toolCallId, screens });
  } catch {
    // Never let a placeholder-computation bug affect the tool call itself.
  }
}

export const batchDesignStreamingAdapter: StreamingToolAdapter = {
  toolName: "batch_design",

  onFrame({ sessionId, toolCallId, input }: StreamingToolFrame): void {
    const operations = extractOperationsScript(input);
    if (operations === undefined) return;
    applyStreamingBatchDesign({ sessionId, toolCallId, operations });
    updatePendingScreens(sessionId, toolCallId, operations);
  },

  onAbandon({ sessionId, toolCallId }: StreamingToolCallRef): void {
    abandonProgressiveBatchSession(sessionId, toolCallId);
    const key = pendingScreenKey(sessionId, toolCallId);
    callStates.delete(key);
    useAiPendingScreenStore.getState().finalizeCall(key);
  },

  onSessionClear(sessionId: string): void {
    clearProgressiveBatchSessions(sessionId);
    for (const key of [...callStates.keys()]) {
      if (key.startsWith(`${sessionId}:`)) callStates.delete(key);
    }
    useAiPendingScreenStore.getState().clearSession(sessionId);
  },
};
