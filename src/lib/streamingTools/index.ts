/**
 * The streaming-tool adapter registry: every `StreamingToolAdapter` that
 * `useDesignChat` dispatches partial tool-call frames to while a turn is
 * streaming. `draw_vector` stages a transient Pixi preview; `batch_design` and
 * `edit_embed_html` apply real, rollback-able scene mutations (see
 * docs/superpowers/specs/2026-09-13-streaming-tool-mutations-design.md).
 *
 * Kept a plain array literal on purpose — no dynamic registration — so the
 * full set of streaming tools is visible in one place.
 */
import type { StreamingToolAdapter } from "@/lib/streamingTools/types";
import { vectorStreamingToolAdapter } from "@/lib/streamingTools/vectorAdapter";
import { batchDesignStreamingAdapter } from "@/lib/streamingTools/batchDesignAdapter";
import { editEmbedHtmlAdapter } from "@/lib/streamingTools/editEmbedHtmlAdapter";
import { generateVectorStreamingAdapter } from "@/lib/streamingTools/generateVectorAdapter";

export const streamingToolAdapters: readonly StreamingToolAdapter[] = [
  vectorStreamingToolAdapter,
  batchDesignStreamingAdapter,
  editEmbedHtmlAdapter,
  generateVectorStreamingAdapter,
];

/** Tool names every registered adapter cares about, for `extractStreamingToolInputs`. */
export const streamingToolNames: ReadonlySet<string> = new Set(
  streamingToolAdapters.map((adapter) => adapter.toolName)
);

const adaptersByToolName = new Map<string, StreamingToolAdapter>(
  streamingToolAdapters.map((adapter) => [adapter.toolName, adapter])
);

/** Looks up the adapter for one tool name, or `undefined` if none is registered. */
export function getStreamingToolAdapter(
  toolName: string
): StreamingToolAdapter | undefined {
  return adaptersByToolName.get(toolName);
}

export type {
  StreamingToolAdapter,
  StreamingToolCallRef,
  StreamingToolFrame,
} from "@/lib/streamingTools/types";
export { isStreamingMutationsEnabled } from "@/lib/streamingTools/types";
