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
import { parseCompleteOperationsPrefix } from "@/lib/tools/batchDesign/parser";
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
 * How many of the syntactically-complete operations at the head of the
 * script already created an embed node — i.e. how many dashed placeholders
 * (in header order) are stale because progressive application already
 * turned them into real nodes.
 *
 * Read-only: reuses `parseCompleteOperationsPrefix`, the exact boundary
 * `progressive.ts` itself trusts, rather than a separate notion of
 * "complete". Never throws — a parse hiccup here must only cost a
 * placeholder, never touch what `applyStreamingBatchDesign` does above.
 */
function countAppliedEmbeds(operations: string): number {
  try {
    const complete = parseCompleteOperationsPrefix(operations);
    let count = 0;
    for (const op of complete) {
      if (op.op !== "I") continue;
      const nodeData = op.args[1];
      if (nodeData?.kind === "json" && isEmbedNodeData(nodeData.value)) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

function isEmbedNodeData(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "embed"
  );
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
    const headers = parsePendingScreenHeaders(operations);
    if (headers.length === 0) return;

    // With progressive application on, the first N headers (by source
    // order, which is what parsePendingScreenHeaders and
    // parseCompleteOperationsPrefix both preserve) are already real nodes
    // on canvas — only the ones after that are still "pending". With the
    // `pen.streamingMutations=off` kill switch, nothing at all has been
    // applied yet, so every header still needs a box.
    const appliedEmbeds = isStreamingMutationsEnabled() ? countAppliedEmbeds(operations) : 0;
    const screens = headers.slice(appliedEmbeds);

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
    useAiPendingScreenStore.getState().finalizeCall(pendingScreenKey(sessionId, toolCallId));
  },

  onSessionClear(sessionId: string): void {
    clearProgressiveBatchSessions(sessionId);
    useAiPendingScreenStore.getState().clearSession(sessionId);
  },
};
