/**
 * Per-tool-call registry of embed ids touched by `batch_design`/
 * `edit_embed_html`, so the Jev taste check (tasteCheck.ts) can run OUTSIDE
 * the scene-mutation queue (see toolCallQueue.ts) instead of inside the tool
 * handler itself.
 *
 * Why this exists at all: tool handlers are shared with WebMCP
 * (registerTools.ts JSON.parses the result), plugins (`pen.scene.batch`) and
 * the desktop MCP bridge, and they run inside `runToolCall`'s global
 * serialized mutation queue. A taste check is a ~8s network round-trip that
 * has nothing to do with the scene graph, so running it INSIDE a handler
 * would hold that queue open for every other mutating call in the editor —
 * exactly the head-of-line stall `toolCallQueue.ts` exists to avoid for
 * long-running reads. Instead, the handler records which embeds it touched
 * here (cheap, synchronous) and returns immediately; only the chat path
 * (useDesignChat.ts's `onToolCall`) — which already knows the queued task
 * has resolved — takes the ids back out and runs the check.
 *
 * `toolCallId` is unique per tool call (assigned by the AI SDK), so it is
 * never reused within a session — `take()` deletes on read, and entries are
 * only ever written once per call, so nothing here needs to distinguish
 * calls beyond that id.
 */

/** Hard cap so an abandoned tool call (no chat path ever reads it back,
 * e.g. an MCP/WebMCP/plugin caller with no `onToolCall`) can't grow this
 * map without bound over a long session. */
const MAX_ENTRIES = 200;

interface TouchedEmbedsEntry {
  /** Every embed this call gave new htmlContent (created or updated). */
  touched: string[];
  /**
   * Subset of `touched` this call CREATED (I()/R()) rather than merely
   * updated (U()) or copied (C() — deliberately excluded, see
   * `executeCopy`'s doc comment) — see `ExecutionContext.createdEmbedIds` in
   * `batchDesign/types.ts`. Always `[]` for `edit_embed_html`, which never
   * creates embeds.
   */
  created: string[];
}

const touchedEmbedsByToolCallId = new Map<string, TouchedEmbedsEntry>();

/**
 * Record the embed ids a tool call touched (and, separately, which of those
 * it created). A no-op without a `toolCallId` (MCP/WebMCP/plugin callers
 * have none — see `ToolExecutionContext`) or when both lists are empty, so
 * callers can invoke this unconditionally.
 */
export function recordTouchedEmbeds(
  toolCallId: string | undefined,
  ids: string[],
  createdIds: string[] = [],
): void {
  if (!toolCallId || (ids.length === 0 && createdIds.length === 0)) return;
  if (!touchedEmbedsByToolCallId.has(toolCallId) && touchedEmbedsByToolCallId.size >= MAX_ENTRIES) {
    // Evict the oldest entry (Map preserves insertion order) rather than
    // refusing the write — an unbounded-growth bug should never turn into a
    // "taste checks silently stop working" bug too.
    const oldestKey = touchedEmbedsByToolCallId.keys().next().value;
    if (oldestKey !== undefined) touchedEmbedsByToolCallId.delete(oldestKey);
  }
  touchedEmbedsByToolCallId.set(toolCallId, { touched: ids, created: createdIds });
}

/**
 * Read and remove this call's touched/created embed ids. Returns `{
 * touched: [], created: [] }` if nothing was recorded.
 */
export function takeTouchedEmbeds(toolCallId: string | undefined): TouchedEmbedsEntry {
  if (!toolCallId) return { touched: [], created: [] };
  const entry = touchedEmbedsByToolCallId.get(toolCallId);
  touchedEmbedsByToolCallId.delete(toolCallId);
  return entry ?? { touched: [], created: [] };
}

/**
 * Peek whether this call recorded anything, WITHOUT consuming it (unlike
 * `takeTouchedEmbeds`). `useDesignChat.ts`'s `onToolCall` uses this to decide
 * whether a batch_design/edit_embed_html call is even worth the cost of
 * computing `brief` and awaiting `runTasteCheckForToolCall` — every other
 * call (including a batch_design/edit_embed_html call that touched no embed)
 * skips straight past that branch and never touches the registry at all.
 */
export function hasTouchedEmbeds(toolCallId: string | undefined): boolean {
  if (!toolCallId) return false;
  return touchedEmbedsByToolCallId.has(toolCallId);
}

/** Test-only: clear the registry between cases. */
export function resetTouchedEmbedsRegistry(): void {
  touchedEmbedsByToolCallId.clear();
}

/** Test-only: current entry count, to assert the bound holds. */
export function touchedEmbedsRegistrySize(): number {
  return touchedEmbedsByToolCallId.size;
}
