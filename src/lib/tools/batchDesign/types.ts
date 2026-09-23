import type { FlatSceneNode } from "@/types/scene";

export type OpType = "I" | "C" | "U" | "R" | "M" | "D" | "G";

export type ParsedArg =
  | { kind: "string"; value: string }
  | { kind: "binding"; name: string }
  | { kind: "concat"; bindingName: string; pathSuffix: string }
  | { kind: "json"; value: unknown }
  | { kind: "number"; value: number };

export interface ParsedOperation {
  binding?: string;
  op: OpType;
  args: ParsedArg[];
  line: number;
  raw: string;
}

export interface ExecutionContext {
  bindings: Map<string, string>;
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
  createdNodeIds: string[];
  issues: string[];
  /**
   * Ids removed (via R()/D()) during execution whose pinned measurements
   * need cleanup — collected here rather than mutated live, since `ctx` is a
   * working copy that only gets committed to the store on full success (see
   * `batchDesign/index.ts`). Applied to `useMeasurementsStore` once, after
   * the scene commit, so a mid-batch execution error (which discards `ctx`
   * entirely) can't leave a stray measurement removal with no matching
   * scene change.
   */
  removedIdsForMeasurementCleanup: Set<string>;
  /**
   * Count of mistyped generate_image/generate_frame_image URLs snapped back
   * to the real one across all embeds touched this batch (see
   * normalizeEmbedNode's call into repairGeneratedImageUrls). Surfaced in the
   * response so the model knows its HTML got silently corrected.
   */
  imageUrlRepairCount: number;
  /**
   * Ids of embed nodes created (I/R), copied (C(), when the source is/holds
   * an embed) or updated with new htmlContent (U) this batch — populated by
   * `normalizeEmbedNode`/`executeCopy`, whose `htmlTouched` guard already
   * draws exactly this line. `index.ts`'s finalize step hands this set (via
   * `recordTouchedEmbeds`, `tasteCheckRegistry.ts`) to the CHAT PATH
   * (`useDesignChat.ts`'s `onToolCall`), which is what actually calls
   * `runTasteCheckForToolCall`/`runTasteCheckForEmbeds` — this module never
   * runs a taste check itself.
   */
  touchedEmbedIds: Set<string>;
  /**
   * Subset of `touchedEmbedIds` that this batch CREATED — via I()/R() —
   * as opposed to a U() that merely gave an existing embed new htmlContent,
   * OR a C() copy (deliberately excluded — see `executeCopy`'s doc comment:
   * a copy is never a creation for taste-check purposes, whether it copies
   * the user's own screen or one the agent already had checked).
   * `tasteCheck.ts`'s `runTasteCheckForToolCall` uses this to keep a U() (or
   * a C()) on an embed the agent never generated (the user's own screen)
   * from ever starting a check: a touched-but-not-created embed is only
   * eligible once it already has a completed check from having been created
   * earlier.
   */
  createdEmbedIds: Set<string>;
}
