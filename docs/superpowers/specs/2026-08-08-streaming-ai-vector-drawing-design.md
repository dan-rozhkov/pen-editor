# Streaming AI Vector Drawing — Design

**Date:** 2026-08-08  
**Status:** Proposed implementation design  
**Repositories:** `pen-editor-backend`, `pen-editor`

## Summary

Add a native, client-executed `draw_vector` tool whose arguments stream through the existing AI SDK v6 UI message protocol. While the language model is still generating the tool's `commands` string, the browser parses only complete command lines into a transient vector draft and renders it in a Pixi overlay. When the complete tool input becomes available, the normal tool handler validates the whole script and atomically commits one real `PathNode` with one undo entry.

This is genuine model-time streaming when the selected OpenRouter model emits incremental function-call arguments. Models that buffer arguments degrade safely to a short local replay followed by the same final commit.

## Evidence and feasibility

No new WebSocket or custom backend event protocol is required:

- The backend calls `streamText` and pipes `pipeUIMessageStreamToResponse` unchanged in `pen-editor-backend/src/routes/chat.ts:187-193,252-267`.
- AI SDK v6 emits `tool-input-start` and `tool-input-delta`, accumulates their text, parses partial JSON, and exposes a tool UI part with `state: "input-streaming"` in `pen-editor/node_modules/ai/src/ui/process-ui-message-stream.ts:511-592`.
- `onToolCall` intentionally runs only after `tool-input-available` in the SDK (`process-ui-message-stream.ts:595-630`) and the editor (`pen-editor/src/hooks/useDesignChat.ts:193-215`). This preserves a clean final validation and commit barrier.
- `PathNode` already supports SVG geometry, structured anchors, handles, bounds, fill, stroke, and closure in `pen-editor/src/types/scene.ts:804-839`.
- The existing Pen tool already proves the transient-draft pattern: `src/store/penToolStore.ts:4-11`, `src/pixi/OverlayRenderer.ts:548-603`, and `src/pixi/interaction/penDraftCommit.ts:19-59`.

Provider support is model-dependent. The installed OpenRouter provider converts streamed function argument fragments into AI SDK tool-input deltas, but an upstream model may still buffer them. Compatibility must therefore be measured for every selectable model.

## Product scope

### Version 1

- One vector contour per `draw_vector` tool call.
- An agent may make multiple calls to build a multi-shape illustration.
- Straight and cubic Bézier segments.
- Open or closed contours.
- Solid fill and solid stroke, including alpha encoded in `#RRGGBBAA`.
- Anchor and handle markers while drawing.
- World-space coordinates with the same auto-parenting behavior as the interactive Pen tool.
- A transient preview that is absent from the scene graph, Layers panel, selection, exports, persistence, and undo history.
- One final native `PathNode` and one undo entry per successful tool call.
- Native task policy only; unavailable in embed-only prototype/slides flows.

### Out of scope

- Compound paths and holes.
- Arc commands, quadratic commands, and multiple subpaths.
- Gradient, image, pattern, video, or multi-paint fills/strokes.
- Streaming arbitrary `batch_design` operations.
- Persisting half-finished AI drafts.
- Collaborative/resumable preview streams.
- Guaranteed genuine streaming for models that buffer tool-call arguments.

## Considered approaches

### A. Dedicated `draw_vector` tool — selected

The tool accepts a name and an append-only command script. A dedicated tool gives the model an explicit capability, keeps the preview parser small, and prevents partial execution of unrelated design operations. It requires a coordinated backend-schema/frontend-handler change.

### B. Preview partial `batch_design.operations`

The model could emit an insert followed by many path updates in one batch, while the client stages completed statements. This avoids a new tool but couples vector preview to the generic batch DSL, bindings, and arbitrary operations. It also encourages repeated full SVG geometry and makes the preview boundary harder to validate. It remains a possible future general streaming architecture, not the v1 choice.

### C. Custom server `data-vector-preview` events

The backend could intercept tool input deltas, normalize them, and merge custom data parts into the UI stream. This duplicates information already delivered by AI SDK and creates a second ordering/error protocol. It is reserved for future needs such as server normalization, resumability, or providers that require a different transport.

## Tool contract

The backend declares a client-executed tool with no `execute` function:

```ts
{
  name: string;       // 1..120 characters
  commands: string;   // 1..32,768 characters
}
```

The command language is line-oriented:

```text
M(120, 80)
L(180, 60)
C(220, 20, 280, 80, 260, 140)
L(160, 170)
CLOSE()
FILL("#65A765")
STROKE("#234A32", 2)
END()
```

Supported commands:

- `M(x, y)`: first anchor; exactly once and first.
- `L(x, y)`: append a straight segment.
- `C(cp1x, cp1y, cp2x, cp2y, x, y)`: set the previous anchor's outgoing handle and append an anchor with an incoming handle.
- `CLOSE()`: close a contour with at least three anchors.
- `FILL(color)`: set a solid `#RRGGBB` or `#RRGGBBAA` fill; only valid after `CLOSE()`.
- `STROKE(color, width)`: set a solid stroke; valid after geometry, width in `(0, 100]`.
- `END()`: final command; nothing may follow it.

Additional limits:

- Maximum 512 anchors and 32,768 command characters.
- Every coordinate must be finite and within `[-1_000_000, 1_000_000]`.
- Final open contours require at least two anchors; final closed contours require at least three.
- Empty lines are accepted; comments and unknown commands are rejected.
- The streaming parser consumes only newline-terminated lines. The final parser also consumes the unterminated tail and requires `END()`.
- The tool description instructs the model to emit geometry first, then `CLOSE`, `FILL`, `STROKE`, and `END`, so the visual order matches the drawing metaphor.

## Architecture

### Backend

1. Add `draw_vector` to `penTools` with a strict Zod input schema and no server execute.
2. Document when to select the tool and the progressive command ordering in its tool description; do not add a universal system-prompt rule that would advertise the tool during embed-only turns.
3. In `prepareChatTurn`, remove `draw_vector` whenever task policy is `prototype` or `slides`; otherwise it would bypass the embed-only rule.
4. Preserve the current UI stream pipeline. No route behavior changes are required.
5. Add a route integration test proving tool-input deltas remain ordered in the SSE output.

The backend schema must land on backend `main` before the frontend handler, per the existing cross-repository tool contract.

### Frontend parser and reducer

`src/lib/tools/drawVector/parser.ts` is pure and owns:

- tokenizing one complete command line;
- validating order, arity, numbers, colors, and limits;
- reducing commands into `PathAnchor[]`, closure, fill, and stroke;
- returning a safe preview from the complete newline-terminated prefix;
- validating the final full script and requiring `END()`;
- generating `geometry` and curve-aware bounds through `anchorsToSVGPath` and `computeAnchorsBBox`.

Partial or malformed trailing text is never passed to Pixi. A malformed completed line marks that draft failed and removes its preview; the final handler returns a tool error without mutating the document.

### Transient store

`src/store/aiVectorPreviewStore.ts` stores drafts under `${sessionId}:${toolCallId}`. Each draft includes:

```ts
interface AiVectorPreviewDraft {
  sessionId: string;
  toolCallId: string;
  name: string;
  commandText: string;
  points: PathAnchor[];
  geometry: string;
  bounds: { x: number; y: number; width: number; height: number };
  closed: boolean;
  fill?: string;
  stroke?: { color: string; width: number };
  phase: "streaming" | "replaying" | "committing" | "failed";
}
```

The store is not persisted and does not interact with history or selection. It provides keyed upsert, phase change, single-draft clear, and session clear. Updates are idempotent because the whole complete prefix is reduced from scratch, so duplicate React renders cannot duplicate anchors.

### Chat integration

A pure extractor finds `tool-draw_vector` UI parts in `chat.messages` whose state is `input-streaming` and whose partial `input.commands` is a string. A `useEffect` in `useDesignChat` sends those snapshots to the transient store, keyed by session and tool-call IDs.

The final `onToolCall` passes an optional execution context `{sessionId, toolCallId}` to the registered handler. Existing handlers ignore this optional second parameter. This also keeps MCP callers compatible because they may continue calling handlers with only arguments.

Cleanup happens on:

- explicit Stop or the registered session abort controller;
- `chat.error`;
- hook unmount/session removal;
- invalid completed command input;
- successful commit.

### Preview rendering

A dedicated AI-vector preview layer is attached to the existing world-space overlay container. It subscribes to the transient store and redraws through one `requestAnimationFrame`, at most once per frame.

For every draft it renders:

- valid geometry only;
- the currently declared stroke, or a temporary blue AI stroke before `STROKE` arrives;
- fill only after both `closed === true` and `FILL` has arrived;
- anchor points and Bézier handles in an AI accent color.

The renderer constructs a temporary `PathNode` and reuses `drawPath`, positions its container at the computed bounds, and never passes malformed SVG to `drawPath` (whose normal fallback is a rectangle). The preview overlay is outside scene-frame raster caches. The render scheduler subscribes to the preview store so every state change requests a canvas render.

### Final commit

On complete input, `drawVector`:

1. Re-parses and validates the full script independently of preview state.
2. If no genuine preview was observed, replays the parsed command prefixes locally for a bounded duration (maximum 600 ms) to provide graceful visual degradation for buffered providers.
3. Builds one `PathNode` using `anchorsToSVGPath`, `computeAnchorsBBox`, `points`, `closed`, `geometryBounds`, `fill`, and `pathStroke`.
4. Calls the existing `addDrawnNodeWithAutoParenting`, matching interactive Pen placement and selection.
5. Marks the draft committing, commits before clearing, then clears on the next animation frame to avoid a blank flash.
6. Returns a JSON tool result containing `success`, created node id, anchor count, and whether genuine streaming or local replay was used.

Preview state is never authoritative. If final validation fails, no scene mutation occurs.

## Failure and concurrency behavior

- Multiple chat sessions and multiple tool calls remain isolated by composite keys.
- Repeated partial snapshots are idempotent.
- A stale snapshot cannot resurrect a completed draft: the store records finalized keys for the lifetime of the active request/session or the observer filters terminal tool states.
- Abort/error/unmount removes transient drafts immediately.
- Invalid complete lines remove the visible draft and preserve an error for the final handler.
- Invalid final input returns an error and leaves scene and history unchanged.
- The 30-second existing tool timeout remains authoritative for the final handler.
- Long scripts and excessive anchors are rejected before they can create unbounded draw work.

## Performance

- React exposes partial tool input at the existing 50 ms chat throttle, which is sufficient for approximately 20 preview updates per second.
- Store-to-Pixi redraws are additionally coalesced to one per animation frame.
- The parser caps work at 32 KiB/512 anchors. Re-reducing a prefix is bounded and simpler than maintaining vulnerable incremental parser state.
- Preview changes never touch `sceneStore`, dirty-node scanning, layout, hit testing, or raster caches.
- The final scene commit follows the existing O(changed) Pixi synchronization path.

## Testing strategy

### Backend

- Zod schema accepts valid input and rejects empty/oversized fields.
- `draw_vector` has no execute function.
- Tool name contract includes it.
- Native turns expose it; prototype/slides turns do not.
- Mock model tool-input start/deltas/end arrive in SSE in order.

### Frontend unit and integration

- Parser command success, order errors, arity, finite/range checks, colors, limits, open/closed minimums, and `END` enforcement.
- Streaming prefix ignores a split command and exposes each subsequent complete line.
- Store key isolation, idempotence, session cleanup, finalized-call protection.
- Chat hook consumes `input-streaming` before final `onToolCall`, passes execution context, clears on stop/error/unmount, and executes exactly once on final input.
- Handler creates the expected native `PathNode`, auto-parents it, creates one undo step, and leaves the document untouched on errors.
- Renderer shows stroke-first/fill-after-close and never invokes malformed-path fallback.
- RAF coalescing test proves multiple store updates schedule at most one redraw.

### End-to-end

A Playwright route streams delayed `tool-input-start`, several `tool-input-delta` chunks, then `tool-input-available`. Assertions confirm:

1. preview pixels/diagnostic state change before final input;
2. no scene node exists during preview;
3. final path appears in scene store and Layers;
4. automatic tool-result continuation occurs;
5. Undo removes the whole path once;
6. a second scenario stops mid-stream and leaves no preview or node.

### Provider compatibility

Run a manual/automated probe against every model exposed by `/api/models`, recording:

- first tool-input-delta latency;
- number and average size of deltas;
- whether at least one usable complete command line arrives before final input;
- fallback use.

A model is marked `live`, `bursty`, or `buffered`. The feature remains correct for all three; only the visual latency differs.

## Acceptance criteria

- A point and valid segment can appear before `tool-input-available` on a streaming-capable model.
- Fill appears only after a closed contour and a streamed `FILL` command.
- Preview never appears in scene state, Layers, selection, exports, persistence, or history.
- Success creates exactly one native `PathNode` and one undo entry.
- Stop, error, invalid input, unmount, and timeout leave no preview or scene mutation.
- Concurrent sessions/tool calls never overwrite one another.
- Prototype/slides cannot call `draw_vector`.
- Buffered providers fall back safely without changing final semantics.
- Frontend lint, unit tests, build, and e2e pass; backend lint, unit tests, and build pass.
