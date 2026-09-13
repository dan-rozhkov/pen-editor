# Live-streamed tool mutations ("brush by brush") — Design

**Date:** 2026-09-13
**Status:** Implementation design
**Repository:** `pen-editor` (frontend only — no backend/tool-contract change)

## Problem

Today only `draw_vector` reacts to streaming tool input: `src/hooks/streamingVectorToolParts.ts`
extracts `state: "input-streaming"` parts and a transient Pixi overlay draws the contour while
the model is still typing. Every other mutating tool waits for `tool-input-available`, so an
entire screen produced by `batch_design` — often 20+ statements and several kilobytes of embed
HTML — appears in one jump after a long silence.

Goal: extend progressive application to the mutating tools that dominate agent turns, so the
design lands statement by statement while the model streams.

## Non-goals

- No backend schema change, no new tool. The AI SDK already streams tool-input deltas;
  everything here is client-side. (Deliberate: keeps the `contract` CI job untouched.)
- No transient "ghost" preview for `batch_design`. A preview would have to duplicate the whole
  scene renderer. Progressive application writes to the real scene instead.
- No change to the `MAX_OPERATIONS = 25` slice or to the resumption protocol.

## Architecture

### 1. A streaming-tool adapter registry (replaces the vector-only wiring)

`src/lib/streamingTools/registry.ts`

```ts
export interface StreamingToolInput { toolCallId: string; input: Record<string, unknown> }

export interface StreamingToolAdapter {
  readonly toolName: string;              // e.g. "batch_design"
  /** Called for every frame of partial input while the call streams. */
  onFrame(ctx: { sessionId: string; toolCallId: string; input: Record<string, unknown> }): void;
  /** The call will never complete (abort/error/unmount): drop or roll back. */
  onAbandon(ctx: { sessionId: string; toolCallId: string }): void;
  /** Drop everything belonging to a chat session. */
  onSessionClear(sessionId: string): void;
}
```

`src/hooks/streamingToolParts.ts` generalizes the existing extractor:

```ts
export function extractStreamingToolInputs(
  messages: UIMessage[],
  toolNames: ReadonlySet<string>,
): Array<{ toolName: string; toolCallId: string; input: Record<string, unknown> }>
```

- A tool UI part is named `tool-<toolName>` by AI SDK v6; keep the existing
  `state === "input-streaming"` filter and the last-occurrence-wins dedupe by `toolCallId`.
- `extractStreamingVectorInputs` stays as a thin, tested wrapper so `draw_vector` behavior and
  its tests are unchanged.

`useDesignChat` keeps exactly one effect, now looping the registry instead of the vector
extractor, and keeps the existing `abandoned`/`seen` tool-call-id refs (generalized to
`Map<toolName, Set<id>>` or a single set of `${toolName}:${id}` keys). The abort / `chat.error` /
unmount paths call `onAbandon` for every seen id and `onSessionClear` for the session — same
lifecycle the vector preview already relies on.

**Kill switch:** `localStorage.pen.streamingMutations = "off"` disables progressive application
for `batch_design` and `edit_embed_html` (never for `draw_vector`, whose preview is transient).
`isStreamingMutationsEnabled()` reads `localStorage` on every delta rather than once per session
(unlike `pen.rasterCache`) — harmless in practice (a `localStorage.getItem` per frame is not a
measurable cost), so this was left as-is rather than "fixed" to match the original intent.

### 2. `batch_design` — progressive real application

The executor already runs against a working copy (`ExecutionContext`) and commits with one
`setState`. Progressive application keeps that working copy **alive across deltas**.

New parser entry point (`src/lib/tools/batchDesign/parser.ts`):

```ts
/** Parse only the statements that are already COMPLETE in a partial script. */
export function parseCompleteOperationsPrefix(partial: string): ParsedOperation[]
```

- Reuses `stripWrapperNoiseLines` + the existing character-level `splitOperationLines` scanner
  (paren/brace/bracket depth + quote state). The scanner must additionally report whether its
  final chunk was flushed at a top-level `\n` boundary or at end-of-input; a chunk flushed at
  end-of-input is the statement still being typed and is **dropped**.
- Never throws: returns `[]` when nothing is complete, and stops at (excluding) the first
  statement `parseLine` cannot parse, instead of failing the frame.

New module `src/lib/tools/batchDesign/progressive.ts` holding a session per
`${sessionId}:${toolCallId}`:

```ts
interface ProgressiveBatchSession {
  baseSnapshot: SceneSnapshot;        // scene before the first applied statement
  ctx: ExecutionContext;              // carried forward, bindings intact
  appliedRaw: string[];               // raw text of each applied statement, in order
  lastCommitted: { nodesById; parentById; childrenById; rootIds } | null; // identity guard
  status: "attached" | "detached" | "degraded";
}
```

`applyStreamingBatchDesign({ sessionId, toolCallId, operations })`:

1. No-op if the key is finalized, the kill switch is off, or `status === "degraded"`.
2. `parseCompleteOperationsPrefix(operations)`; slice to `MAX_OPERATIONS`; if its length
   `<= appliedRaw.length`, no-op (nothing new).
3. Verify the already-applied statements are still a verbatim prefix (`op.raw` equality). A
   divergence means the partially-decoded string changed shape → mark `degraded` and roll back
   (see below); the final handler then runs the normal path.
4. Foreign-mutation guard: if `lastCommitted` is set and the live store's `nodesById` is not the
   same object reference we wrote, someone else mutated the scene → mark `detached` (do NOT
   roll back; rolling back would destroy their edit). Applying continues from a fresh
   `ExecutionContext` seeded from the live state with the session's `bindings` carried over.
5. Execute the new statements into `ctx` via `executeOperation`. On a throw → mark `degraded`
   and roll back if `attached`.
6. On the first successful statement, record `baseSnapshot = createSnapshot(liveState)`.
7. Commit with a single `useSceneStore.setState({ nodesById, parentById, childrenById, rootIds,
   _cachedTree: null })` — **no `saveHistory`**, so streaming never touches undo. Remember the
   committed object references in `lastCommitted`.
8. Defer `propagateComponentChanges`, measurement cleanup and `serializeCreatedNodes` to the
   final commit.

Rollback (`attached` only, and only while `nodesById === lastCommitted.nodesById`): a single
`setState` restoring `baseSnapshot`'s four fields — history untouched, because streaming never
pushed an entry.

`batchDesign` handler (`index.ts`), final input, now `(args, context)`:

- `takeProgressiveSession(sessionId, toolCallId)` (removes it and finalizes the key).
- **attached & prefix matches the final parse:** continue executing the remaining operations
  into the carried `ctx`, then `saveHistory(session.baseSnapshot)` + one `setState` →
  **exactly one undo entry** covering the progressively-applied part too.
- **detached & prefix matches:** build a fresh `ExecutionContext` from the live state, carry
  `ctx.bindings` and `createdNodeIds`, execute only the remaining operations, then
  `saveHistory(liveSnapshot)` + one `setState`. Honest limitation (see "Failure and concurrency
  behavior" below): the streamed prefix ends up folded into the *same* undo entry as the foreign
  edit, not a separate one — this is not "two undo steps" in the sense of two clean, independent
  entries.
  - If this session's `createdNodeIds` did not all survive the foreign edit (e.g. an undo
    mid-stream removed them), the fork can no longer be trusted at all: fall through to the same
    "prefix does not match" recovery below, then run the existing (never-streamed) path fresh —
    `lenient: true` unconditionally, since a detached session never gets the full-rollback
    recovery.
- **prefix does not match, or `degraded`:** if a rollback to `baseSnapshot` is still safe (never
  true for a `detached` session), roll back and run the existing path unchanged. If it is not
  safe, delete `session.ctx.createdNodeIds` from the live state first so nothing is duplicated,
  then run the existing path in a **lenient** mode: a statement whose target no longer exists
  (`U()`/`D()`/`M()`/`G()`'s "Node not found") is skipped and recorded in `issues` instead of
  failing the whole batch, because the streamed prefix may already have applied it and rolling
  that back wasn't safe. Without this, a script containing `D()`/`U()` in the streamed prefix
  would fail outright on the fresh re-run the moment it reached a target the prefix already
  consumed.
- **no session at all** (MCP/WebMCP callers, buffering model, kill switch off): the existing
  path, byte for byte.

The response shape returned to the model is unchanged in every path.

Serialization: progressive application runs outside `toolCallQueue`. That is the reason for the
identity guard in step 4 — it is the only mutual-exclusion this path has.

### 3. `edit_embed_html` — progressive re-derivation

Arguments stream as `{ nodeId, edits: [{ oldString, newString, replaceAll? }] }`. A partially
decoded `newString` must never be applied cumulatively, so every frame is **re-derived from the
original HTML**, exactly like the vector parser re-reduces its whole prefix:

`src/lib/tools/editEmbedHtml/progressive.ts`

1. On the first frame for a key, snapshot `originalHtml` (`sourceTemplate ?? htmlContent`) and
   the scene snapshot.
2. Each frame: keep only edits whose `oldString` and `newString` are both strings and whose
   `oldString` is non-empty; run `applyAnchorEdits(originalHtml, keptEdits)` in a lenient mode
   that skips an edit whose anchor is not found instead of throwing (a truncated `newString`
   from the previous frame is irrelevant — we always start from `originalHtml`).
3. Write the result onto the node with one `setState`, no `saveHistory`, plus the same
   `lastCommitted` identity guard and rollback rules as `batch_design`.
4. The final handler restores `originalHtml` on the node before running its existing strict
   path, so validation, `<c-*>` re-expansion and linting see exactly what they see today, and a
   single `saveHistory` produces one undo entry. On abandon: roll back to `originalHtml`.

Nodes that are not embeds, or a `nodeId` that arrives after edits (partial JSON ordering), are
simply skipped until the frame carries both.

## Failure and concurrency behavior

- Abort / `chat.error` / unmount → `onAbandon` for every seen tool-call id → recovery of any
  partially applied batch (a full rollback where safe, or — for a `detached` session, where a
  full rollback would erase a foreign edit — surgically deleting just the nodes the batch itself
  created), and a permanent finalized key so a late frame cannot resurrect it (the
  `finalizedKeys` lesson from the vector work).
- Undo is never written during streaming, so an abandoned stream cannot leave an undo entry.
- A buffering model simply never produces a session and gets today's behavior.
- Two chat sessions and two concurrent tool calls stay isolated by the composite key.

**Honest limitation: a foreign edit that interleaves with a streamed batch is not separately
undoable from it.** When a session detaches (a foreign edit landed) and later finalizes, the
history snapshot is taken from the live store's state *at that moment* — which already contains
everything the batch streamed, because the streamed prefix was committed before the foreign edit
ever landed. Saving history from that snapshot folds the streamed prefix into the *same* undo
entry as the foreign edit, not a separate one: one Ctrl+Z reverts the batch's own remainder (the
operations executed after the detach point), and the next Ctrl+Z reverts the foreign edit *and*
the streamed prefix together, as one entry. There is no history entry anywhere that separates
"what the user did" from "what the streamed batch had already applied before that." (An earlier
draft of this document claimed undo "still takes two steps" here, implying a clean two-entry
split — that was wrong; there are two steps, but the second one is not a clean undo of just the
foreign edit.)

This is not something to patch by saving the session's pre-batch `baseSnapshot` in the detached
path instead — that would make the *first* Ctrl+Z (or the very act of finalizing) discard the
user's foreign edit, which is worse than the current behavior. A clean split would need per-node
(or per-field) undo history — each node keeping its own timeline, so the streamed prefix's edits
and the foreign edit's edits could be told apart and undone independently regardless of
interleaving — and the store's `historyStore` only ever snapshots and restores the whole
document, so it has no way to represent that. Fixing this properly is a store-level change, out
of scope here.

## Testing

- `parseCompleteOperationsPrefix`: drops the in-progress trailing statement, handles a newline
  inside a brace/quote (embed HTML with `\n`), markdown fences, zero complete statements,
  unparseable statement mid-prefix.
- `progressive.ts` (batch_design): statements land in the store without an undo entry; final
  commit adds exactly one undo entry and does not duplicate nodes; divergent prefix rolls back;
  foreign mutation detaches instead of rolling back; abandon rolls back an attached session, and
  cleans up (deletes the nodes it created) a detached one instead of stranding them; a script
  mixing `I()` and `D()` that detaches mid-stream recovers via the lenient fresh re-run instead
  of failing the whole batch with a "Node not found" execution error.
- `edit_embed_html` progressive: re-derivation from original, lenient anchor skip, final strict
  path unchanged, abandon restores the original HTML.
- `extractStreamingToolInputs`: multi-tool extraction, dedupe, non-streaming states ignored.
- `useDesignChat`: a streamed `batch_design` part mutates the store before the tool call
  completes, and the completed call leaves one undo entry.
- Existing `draw_vector` tests must keep passing untouched.
