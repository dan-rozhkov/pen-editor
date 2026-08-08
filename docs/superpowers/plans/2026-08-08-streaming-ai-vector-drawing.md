# Streaming AI Vector Drawing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the native AI design agent visibly construct a vector path point-by-point while its tool arguments stream, then commit one real undoable `PathNode`.

**Architecture:** Add a client-executed backend `draw_vector` schema whose line-oriented command string is already carried incrementally by AI SDK UI Message Stream. The frontend observes `input-streaming` tool parts, reduces only complete lines into a transient Zustand draft, and renders that draft in a Pixi overlay; complete validated input remains the sole barrier for creating the scene node.

**Tech Stack:** TypeScript, Zod, Vercel AI SDK v6 UI streams, React 19, Zustand 5, PixiJS 8, Vitest, happy-dom, Playwright.

## Global Constraints

- One contour per tool call; multiple calls may build a multi-shape illustration.
- V1 supports `M`, `L`, cubic `C`, `CLOSE`, solid `FILL`, solid `STROKE`, and `END` only.
- Maximum 32,768 command characters, 512 anchors, coordinate magnitude 1,000,000, and stroke width 100.
- Preview state must never enter scene state, history, selection, Layers, export, or `.pen` persistence.
- Complete final input creates exactly one `PathNode` and one undo entry.
- Stop, error, timeout, invalid input, unmount, and session removal leave no preview or scene mutation.
- `draw_vector` is available only for native task policy; prototype/slides stay embed-only.
- Preserve the existing AI SDK UI stream; do not add WebSocket or custom server data events.
- Keep backend client tools without `execute` functions.
- Backend relative TypeScript imports include `.js`; frontend imports use `@/` aliases.
- Merge backend schema to backend `main` first, then merge frontend support immediately afterward.

---

## File Structure

### `pen-editor-backend`

- Modify `src/ai/tools.ts` — Zod schema, tool description, and `penTools.draw_vector` declaration.
- Modify `src/ai/chatTurn.ts` — remove the native vector tool under embed-only task policies.
- Modify `test/tools-contract.test.ts` — tool-name, no-execute, and input-schema contracts.
- Modify `test/chat-turn.test.ts` — native exposure and prototype/slides exclusion.
- Modify `test/chat-route.test.ts` — prove start/delta/final tool chunks survive the HTTP SSE route in order.

### `pen-editor`

- Create `src/lib/tools/drawVector/types.ts` — command parse/draft contracts shared by parser, store, renderer, and handler.
- Create `src/lib/tools/drawVector/parser.ts` — pure preview-prefix and final-script parser/reducer.
- Create `src/lib/tools/drawVector/previewController.ts` — map streaming input to keyed drafts and run bounded fallback replay.
- Create `src/lib/tools/drawVector/index.ts` — final client tool handler and atomic scene commit.
- Create `src/store/aiVectorPreviewStore.ts` — non-persisted keyed draft lifecycle.
- Create `src/hooks/streamingVectorToolParts.ts` — pure extraction of partial `tool-draw_vector` parts from UI messages.
- Create `src/pixi/aiVectorPreviewLayer.ts` — Pixi world-overlay rendering and RAF coalescing.
- Modify `src/lib/toolRegistry.ts` — register `draw_vector` and add optional execution context.
- Modify `src/hooks/useDesignChat.ts` — observe partial input, pass execution context, and clear previews on every terminal path.
- Modify `src/pixi/OverlayRenderer.ts` — mount and clean up the dedicated preview layer.
- Modify `src/pixi/renderScheduler.ts` — invalidate canvas renders when preview state changes.
- Modify `src/main.tsx` — expose the preview store only in dev for deterministic e2e assertions.
- Modify `src/lib/__tests__/toolContract.test.ts` — pin the new cross-repository handler.
- Create `src/lib/tools/drawVector/__tests__/parser.test.ts` — parser/reducer contracts.
- Create `src/store/__tests__/aiVectorPreviewStore.test.ts` — keyed lifecycle and cleanup.
- Create `src/lib/tools/drawVector/__tests__/drawVector.test.ts` — commit, history, placement, and failure tests.
- Create `src/pixi/__tests__/aiVectorPreviewLayer.test.ts` — rendering stages and RAF coalescing with mocked Pixi primitives.
- Modify `src/hooks/__tests__/useDesignChat.test.ts` — partial-stream, execution context, and lifecycle integration.
- Create `e2e/ai-vector-streaming.spec.ts` — real browser preview-before-commit, undo, and cancel scenarios.

---

### Task 1: Declare the backend tool and lock its contract

**Repository:** `pen-editor-backend`

**Files:**
- Modify: `src/ai/tools.ts`
- Modify: `test/tools-contract.test.ts`

**Interfaces:**
- Produces: `drawVectorInputSchema: z.ZodType<{name: string; commands: string}>`
- Produces: `penTools.draw_vector`, a client-executed AI SDK tool with no `execute`
- Consumes: existing `tool()`/Zod conventions in `src/ai/tools.ts`

- [ ] **Step 1: Add failing tool-name and schema tests**

Add `draw_vector` to the exact expected tool-name array and client-executed array in `test/tools-contract.test.ts`. Add focused schema tests:

```ts
describe("draw_vector schema", () => {
  const schema = schemaOf("draw_vector");

  it("accepts a bounded progressive vector script", () => {
    expect(schema.safeParse({
      name: "Leaf",
      commands: [
        "M(120, 80)",
        "L(180, 60)",
        "L(160, 160)",
        "CLOSE()",
        'FILL("#65A765")',
        "END()",
      ].join("\n"),
    }).success).toBe(true);
  });

  it.each([
    { name: "", commands: "M(0,0)\nL(1,1)\nEND()" },
    { name: "Vector", commands: "" },
    { name: "Vector", commands: "x".repeat(32_769) },
  ])("rejects invalid bounds: %j", (input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the backend contract test and verify RED**

Run:

```bash
cd /Users/daniilrozhkov/prj/pen-editor-app/pen-editor-backend
npm test -- --run test/tools-contract.test.ts
```

Expected: FAIL because `penTools.draw_vector` and its schema do not exist.

- [ ] **Step 3: Add the strict schema and tool declaration**

In `src/ai/tools.ts`, add:

```ts
export const drawVectorInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  commands: z.string().min(1).max(32_768),
});

const drawVectorTool = tool({
  description: `Draw one native vector contour progressively on the canvas. Use this instead of batch_design when the user requests a freeform native vector, icon/logo contour, or explicitly wants to watch the agent draw.
The browser previews each complete command line while this tool input streams, then commits one PathNode after full validation.
Commands, exactly one per line and in this order:
- M(x, y) once, first
- L(x, y) for a straight segment
- C(cp1x, cp1y, cp2x, cp2y, x, y) for a cubic segment
- CLOSE() before filling a closed contour
- FILL("#RRGGBB" or "#RRGGBBAA") only after CLOSE()
- STROKE("#RRGGBB" or "#RRGGBBAA", width)
- END() once, last
Emit geometry lines first so points and segments appear before fill. One tool call draws one contour; call the tool again for another shape.`,
  inputSchema: drawVectorInputSchema,
});
```

Register `draw_vector: drawVectorTool` in `penTools`. Do not add `execute`.

- [ ] **Step 4: Run contract tests and verify GREEN**

Run:

```bash
npm test -- --run test/tools-contract.test.ts
```

Expected: PASS, including `hasExecute("draw_vector") === false`.

- [ ] **Step 5: Run backend type/lint gates**

Run:

```bash
npm run lint
npm run build
```

Expected: both exit 0.

- [ ] **Step 6: Commit the backend schema contract**

```bash
git add src/ai/tools.ts test/tools-contract.test.ts
git commit -m "feat(ai): declare progressive vector drawing tool"
```

---

### Task 2: Enforce task policy and verify delta passthrough

**Repository:** `pen-editor-backend`

**Files:**
- Modify: `src/ai/chatTurn.ts`
- Modify: `test/chat-turn.test.ts`
- Modify: `test/chat-route.test.ts`

**Interfaces:**
- Consumes: `penTools.draw_vector` from Task 1
- Produces: native turns expose `draw_vector`; `prototype`/`slides` turns do not
- Preserves: standard AI SDK `tool-input-start`/`tool-input-delta`/`tool-input-available` SSE

- [ ] **Step 1: Write failing task-policy assertions**

Extend `test/chat-turn.test.ts`:

```ts
expect(turn.tools.draw_vector).toBeUndefined(); // in /prototype test
```

Add the native assertion:

```ts
expect(turn.tools.draw_vector).toBe(penTools.draw_vector);
```

Add the same absence assertion to the existing slides-policy coverage, or create a `/slides` case if none exists.

- [ ] **Step 2: Run the task-policy test and verify RED**

```bash
npm test -- --run test/chat-turn.test.ts
```

Expected: prototype/slides assertion FAIL because the universal tool set still exposes `draw_vector`.

- [ ] **Step 3: Remove the tool under embed-only policy**

After assembling the mutable `tools` object in `src/ai/chatTurn.ts`, keep the existing batch guard and remove the bypass:

```ts
if (taskPolicy !== "native") {
  tools.batch_design = makeBatchDesignTool({ embedOnly: true });
  delete tools.draw_vector;
}
```

- [ ] **Step 4: Add an HTTP stream regression test with real deltas**

In `test/chat-route.test.ts`, configure `MockLanguageModelV3` with provider chunks equivalent to:

```ts
[
  { type: "stream-start", warnings: [] },
  { type: "tool-input-start", id: "call-vector", toolName: "draw_vector" },
  { type: "tool-input-delta", id: "call-vector", delta: '{"name":"Leaf","commands":"M(10,10)\\n' },
  { type: "tool-input-delta", id: "call-vector", delta: 'L(20,20)\\nEND()"}' },
  { type: "tool-input-end", id: "call-vector" },
  { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: USAGE },
]
```

Assert SSE positions, not only containment:

```ts
const start = body.indexOf('"type":"tool-input-start"');
const firstDelta = body.indexOf('"type":"tool-input-delta"');
const available = body.indexOf('"type":"tool-input-available"');
expect(start).toBeGreaterThan(-1);
expect(firstDelta).toBeGreaterThan(start);
expect(available).toBeGreaterThan(firstDelta);
expect(body).not.toContain('"type":"tool-output-available"');
```

- [ ] **Step 5: Run focused and full backend verification**

```bash
npm test -- --run test/chat-turn.test.ts test/chat-route.test.ts
npm run lint
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit policy and streaming coverage**

```bash
git add src/ai/chatTurn.ts test/chat-turn.test.ts test/chat-route.test.ts
git commit -m "feat(ai): route progressive vectors through native turns"
```

- [ ] **Step 7: Merge backend before beginning frontend merge**

Push/merge the two backend commits to `pen-editor-backend/main`, then confirm its CI is green. Keep the frontend contract gap short; do not merge frontend first.

---

### Task 3: Build the pure vector command parser

**Repository:** `pen-editor`

**Files:**
- Create: `src/lib/tools/drawVector/types.ts`
- Create: `src/lib/tools/drawVector/parser.ts`
- Create: `src/lib/tools/drawVector/__tests__/parser.test.ts`

**Interfaces:**
- Produces: `parseVectorCommands(text, mode): VectorParseResult`
- Produces: `buildVectorReplayFrames(text): ParsedVectorDraft[]`
- Consumes: `PathAnchor`, `anchorsToSVGPath`, `computeAnchorsBBox`

- [ ] **Step 1: Define tests for the public parser behavior**

Create tests covering this table:

```ts
const VALID = [
  "M(10, 20)",
  "L(50, 20)",
  "C(60, 20, 80, 40, 50, 80)",
  "CLOSE()",
  'FILL("#ff000080")',
  'STROKE("#112233", 2)',
  "END()",
].join("\n");

it("reduces a valid final script to anchors, geometry, bounds and paints", () => {
  const result = parseVectorCommands(VALID, "final");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.draft.points).toHaveLength(3);
  expect(result.draft.points[1].handleOut).toEqual({ x: 60, y: 20 });
  expect(result.draft.points[2].handleIn).toEqual({ x: 80, y: 40 });
  expect(result.draft.closed).toBe(true);
  expect(result.draft.geometry).toMatch(/^M10,20 L50,20 C/);
  expect(result.draft.fill).toBe("#ff000080");
  expect(result.draft.stroke).toEqual({ color: "#112233", width: 2 });
  expect(result.draft.ended).toBe(true);
});

it("ignores only the unterminated final line in preview mode", () => {
  const result = parseVectorCommands("M(1, 2)\nL(3,", "preview");
  expect(result.ok && result.draft.points).toHaveLength(1);
});

it("consumes an unterminated END tail in final mode", () => {
  expect(parseVectorCommands("M(1,2)\nL(3,4)\nEND()", "final").ok).toBe(true);
});
```

Add `it.each` failures for command before `M`, duplicate `M`, too few anchors, fill before close, command after `END`, missing `END`, unknown command, bad arity, NaN/Infinity, coordinates outside bounds, bad color, width `<= 0`/`> 100`, >512 anchors, and >32,768 characters.

Add replay-frame assertions: `M`, each `L/C`, `CLOSE`, `FILL`, and `STROKE` create ordered visual frames; `END` does not.

- [ ] **Step 2: Run the parser test and verify RED**

```bash
cd /Users/daniilrozhkov/prj/pen-editor-app/pen-editor
npm test -- --run src/lib/tools/drawVector/__tests__/parser.test.ts
```

Expected: FAIL because parser modules do not exist.

- [ ] **Step 3: Define focused shared types**

In `types.ts`:

```ts
import type { PathAnchor } from "@/types/scene";

export interface ParsedVectorDraft {
  points: PathAnchor[];
  geometry: string;
  bounds: { x: number; y: number; width: number; height: number };
  closed: boolean;
  fill?: string;
  stroke?: { color: string; width: number };
  ended: boolean;
}

export type VectorParseResult =
  | { ok: true; draft: ParsedVectorDraft; completeLineCount: number }
  | { ok: false; error: string; line: number };

export type VectorParseMode = "preview" | "final";
```

- [ ] **Step 4: Implement the minimal parser/reducer**

In `parser.ts`:

- reject input over `MAX_COMMAND_CHARS` before splitting;
- for preview mode, remove the last split item when the source does not end in `\n`;
- parse each non-empty trimmed line with anchored regular expressions;
- parse numeric tokens using `Number`, then apply `Number.isFinite` and magnitude checks;
- copy anchors on every change so replay frames cannot be mutated by later commands;
- map `C` as:

```ts
points[points.length - 1] = {
  ...points.at(-1)!,
  handleOut: { x: cp1x, y: cp1y },
};
points.push({ x, y, handleIn: { x: cp2x, y: cp2y } });
```

- after every geometry change, derive `geometry` and `bounds` through existing pure helpers;
- in final mode require `END`, enforce open/closed anchor minimums, and reject any non-empty line after `END`;
- make `buildVectorReplayFrames` run the final parser once for validation, then reduce complete prefixes and return only visually distinct frames.

Do not accept general SVG, comments, expressions, variable references, or JSON5.

- [ ] **Step 5: Run parser and existing path helper tests**

```bash
npm test -- --run src/lib/tools/drawVector/__tests__/parser.test.ts src/utils/__tests__/pathAnchors.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the parser**

```bash
git add src/lib/tools/drawVector/types.ts src/lib/tools/drawVector/parser.ts src/lib/tools/drawVector/__tests__/parser.test.ts
git commit -m "feat(canvas): parse progressive vector commands"
```

---

### Task 4: Add the transient preview store and controller

**Repository:** `pen-editor`

**Files:**
- Create: `src/store/aiVectorPreviewStore.ts`
- Create: `src/store/__tests__/aiVectorPreviewStore.test.ts`
- Create: `src/lib/tools/drawVector/previewController.ts`
- Extend: `src/lib/tools/drawVector/__tests__/parser.test.ts` or create `previewController.test.ts`

**Interfaces:**
- Produces: `vectorPreviewKey(sessionId, toolCallId): string`
- Produces: `upsertStreamingVectorPreview(input): void`
- Produces: `replayVectorPreview(input): Promise<void>`
- Produces: store actions `markCommitting`, `clearDraft`, `clearSession`, `finalizeCall`
- Consumes: parser APIs from Task 3

- [ ] **Step 1: Write failing store lifecycle tests**

Test exact behavior:

```ts
it("isolates drafts by session and tool call", () => {
  const store = useAiVectorPreviewStore.getState();
  store.upsert(makeDraft("session-a", "call-1"));
  store.upsert(makeDraft("session-b", "call-1"));
  expect(Object.keys(useAiVectorPreviewStore.getState().drafts)).toHaveLength(2);
});

it("clears only one session and cannot resurrect a finalized call", () => {
  const key = vectorPreviewKey("session-a", "call-1");
  const store = useAiVectorPreviewStore.getState();
  store.upsert(makeDraft("session-a", "call-1"));
  store.finalizeCall(key);
  store.upsert(makeDraft("session-a", "call-1"));
  expect(useAiVectorPreviewStore.getState().drafts[key]).toBeUndefined();
});
```

Also test same-input idempotence, phase changes, failed parse removal, and full reset for fixtures.

- [ ] **Step 2: Run store tests and verify RED**

```bash
npm test -- --run src/store/__tests__/aiVectorPreviewStore.test.ts
```

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement a non-persisted keyed store**

Use plain Zustand `create`, not persistence middleware. State shape:

```ts
export interface AiVectorPreviewDraft extends ParsedVectorDraft {
  sessionId: string;
  toolCallId: string;
  name: string;
  commandText: string;
  phase: "streaming" | "replaying" | "committing" | "failed";
  receivedDuringStreaming: boolean;
}

interface AiVectorPreviewState {
  drafts: Record<string, AiVectorPreviewDraft>;
  finalizedKeys: ReadonlySet<string>;
  upsert: (draft: AiVectorPreviewDraft) => void;
  markCommitting: (key: string) => void;
  clearDraft: (key: string) => void;
  clearSession: (sessionId: string) => void;
  finalizeCall: (key: string) => void;
  reset: () => void;
}
```

Clone `Set` and `drafts` on mutations. `finalizeCall` adds the key and removes its draft atomically. `clearSession` removes both drafts and finalized keys belonging to the session so future tool-call IDs in a recreated session are not permanently blocked.

- [ ] **Step 4: Implement stream upsert and bounded replay**

`upsertStreamingVectorPreview` accepts `{sessionId, toolCallId, name, commands}`. It calls `parseVectorCommands(commands, "preview")`; if valid and at least one anchor exists, upsert with `receivedDuringStreaming: true`; if a completed line is invalid, clear/finalize the key.

`replayVectorPreview`:

```ts
export async function replayVectorPreview(input: {
  sessionId: string;
  toolCallId: string;
  name: string;
  commands: string;
  maxDurationMs?: number;
}): Promise<void>
```

Build frames once. Use `delay = Math.min(60, Math.max(16, maxDurationMs / frames.length))`, upsert each with phase `replaying`, and stop early if the key becomes finalized. Cap total elapsed replay at 600 ms.

- [ ] **Step 5: Use fake timers to test replay deterministically**

Assert the first frame appears before completion, frames remain ordered, the duration is `<= 600 ms`, and clearing/finalizing mid-replay prevents resurrection.

- [ ] **Step 6: Run focused tests and commit**

```bash
npm test -- --run src/store/__tests__/aiVectorPreviewStore.test.ts src/lib/tools/drawVector/__tests__
git add src/store/aiVectorPreviewStore.ts src/store/__tests__/aiVectorPreviewStore.test.ts src/lib/tools/drawVector/previewController.ts src/lib/tools/drawVector/__tests__
git commit -m "feat(canvas): stage transient AI vector previews"
```

---

### Task 5: Render preview geometry in the Pixi overlay

**Repository:** `pen-editor`

**Files:**
- Create: `src/pixi/aiVectorPreviewLayer.ts`
- Create: `src/pixi/__tests__/aiVectorPreviewLayer.test.ts`
- Modify: `src/pixi/OverlayRenderer.ts`
- Modify: `src/pixi/renderScheduler.ts`

**Interfaces:**
- Produces: `createAiVectorPreviewLayer(overlayContainer: Container): () => void`
- Consumes: `useAiVectorPreviewStore`, `drawPath`, viewport scale
- Preserves: no sceneStore, selection, layout, hit-test, or raster-cache writes

- [ ] **Step 1: Write failing renderer behavior tests**

Mock/spy on Pixi `Graphics` methods and test:

- one-anchor draft draws an anchor but no invalid path;
- open geometry gets temporary blue stroke and no fill;
- closed geometry without `FILL` remains unfilled;
- streamed `FILL` appears only when `closed` is true;
- cubic handles and anchor markers render;
- two synchronous store updates schedule one RAF and one redraw;
- cleanup unsubscribes, cancels RAF, removes/destroys containers;
- malformed/empty geometry never reaches `drawPath` and therefore never triggers its rectangle fallback.

- [ ] **Step 2: Run renderer test and verify RED**

```bash
npm test -- --run src/pixi/__tests__/aiVectorPreviewLayer.test.ts
```

Expected: FAIL because the layer does not exist.

- [ ] **Step 3: Implement the dedicated preview layer**

Create one root `Container` labelled `ai-vector-previews`. Maintain a `Map<string, Container>` so drafts update in place. On each RAF:

1. remove containers whose keys disappeared;
2. for every current draft, create/reuse a container with a path `Graphics` and marker `Graphics`;
3. set container position to `draft.bounds.x/y`;
4. create a temporary `PathNode` whose geometry uses raw world coordinates and whose `geometryBounds` is the draft bounds;
5. set `width/height` to bounds, `fill` only when closed, and `pathStroke` to the declared stroke or `{fill: "#0d99ff", thickness: 1.5, cap: "round", join: "round"}`;
6. call `drawPath` only when at least two anchors exist and geometry parsed successfully;
7. draw anchors/handles in local coordinates by subtracting bounds origin, with marker radii divided by viewport scale.

Subscribe to `useAiVectorPreviewStore` and schedule one RAF. Return cleanup that unsubscribes and destroys the root.

- [ ] **Step 4: Mount the layer and invalidate rendering**

In `createOverlayRenderer`, immediately after the existing pen preview setup:

```ts
const destroyAiVectorPreviewLayer = createAiVectorPreviewLayer(overlayContainer);
```

Call it in cleanup.

In `renderScheduler.ts`, import the store and add:

```ts
useAiVectorPreviewStore.subscribe(markActivity),
```

The overlay is outside cached scene frames, so do not call `rasterCacheManager.onDirectContainerMutation`.

- [ ] **Step 5: Run renderer, scheduler, and path-renderer tests**

```bash
npm test -- --run src/pixi/__tests__/aiVectorPreviewLayer.test.ts src/pixi/renderers/__tests__/pathRenderer.test.ts
npm run build
```

Expected: PASS and build exit 0.

- [ ] **Step 6: Commit the preview layer**

```bash
git add src/pixi/aiVectorPreviewLayer.ts src/pixi/__tests__/aiVectorPreviewLayer.test.ts src/pixi/OverlayRenderer.ts src/pixi/renderScheduler.ts
git commit -m "feat(canvas): render streaming AI vector drafts"
```

---

### Task 6: Commit the final vector through the frontend tool registry

**Repository:** `pen-editor`

**Files:**
- Create: `src/lib/tools/drawVector/index.ts`
- Create: `src/lib/tools/drawVector/__tests__/drawVector.test.ts`
- Modify: `src/lib/toolRegistry.ts`
- Modify: `src/lib/__tests__/toolContract.test.ts`

**Interfaces:**
- Produces: `ToolExecutionContext { sessionId?: string; toolCallId?: string }`
- Produces: `drawVector(args, context): Promise<string>`
- Consumes: final parser, replay controller, preview store, `addDrawnNodeWithAutoParenting`

- [ ] **Step 1: Add the failing frontend contract entry**

Import/register `drawVector` under `draw_vector` and add the name to the frontend pinned list test. With backend Task 1 already on `main`, the cross-repo test must now expect exact equality.

Run:

```bash
npm test -- --run src/lib/__tests__/toolContract.test.ts
```

Expected before implementation: FAIL because registry lacks the handler.

- [ ] **Step 2: Write handler tests against real stores**

Using `resetStores()` in `beforeEach`, test:

```ts
const output = JSON.parse(await drawVector(
  {
    name: "Leaf",
    commands: [
      "M(100,100)",
      "L(200,100)",
      "L(150,200)",
      "CLOSE()",
      'FILL("#65a765")',
      'STROKE("#234a32",2)',
      "END()",
    ].join("\n"),
  },
  { sessionId: "s1", toolCallId: "c1" },
));
expect(output).toMatchObject({ success: true, anchorCount: 3 });
```

Assert:

- exactly one `path` exists;
- `points`, `geometry`, `geometryBounds`, `closed`, `fill`, and `pathStroke` match;
- inside an existing containing frame, auto-parenting produces parent-local `x/y`;
- one undo removes the complete node;
- invalid final script and wrong argument types do not mutate scene/history;
- missing execution context (for example, a direct MCP registry call) commits synchronously without preview/replay;
- a previously streamed preview skips replay;
- no preview invokes bounded replay;
- commit happens before the preview key is finalized/cleared.

- [ ] **Step 3: Extend the handler signature without breaking callers**

In `toolRegistry.ts`:

```ts
export interface ToolExecutionContext {
  sessionId?: string;
  toolCallId?: string;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
) => Promise<string>;
```

Existing handlers need no edits because TypeScript permits functions with fewer parameters. MCP bridge callers keep passing one argument.

- [ ] **Step 4: Implement final validation, replay, and commit**

The handler must:

```ts
const parsed = parseVectorCommands(commands, "final");
if (!parsed.ok) return JSON.stringify({ error: parsed.error, line: parsed.line });

const key = context?.sessionId && context.toolCallId
  ? vectorPreviewKey(context.sessionId, context.toolCallId)
  : undefined;
const existing = key ? useAiVectorPreviewStore.getState().drafts[key] : undefined;
if (key && !existing?.receivedDuringStreaming) {
  await replayVectorPreview({ sessionId, toolCallId, name, commands, maxDurationMs: 600 });
}
```

Then create a generated-id `PathNode` matching `penDraftCommit.ts`:

```ts
const node: PathNode = {
  id,
  type: "path",
  name,
  x: bounds.x,
  y: bounds.y,
  width: bounds.width,
  height: bounds.height,
  geometry,
  geometryBounds: bounds,
  points,
  closed,
  ...(fill ? { fill } : {}),
  ...(stroke ? {
    pathStroke: {
      fill: stroke.color,
      thickness: stroke.width,
      join: "round",
      cap: "round",
      align: "center",
    },
  } : {}),
};
```

Call `addDrawnNodeWithAutoParenting(node, bounds, id)`. Mark the draft committing before commit; finalize it in `requestAnimationFrame` after commit. Return:

```ts
JSON.stringify({
  success: true,
  createdNode: { id, name, type: "path" },
  anchorCount: points.length,
  streamed: existing?.receivedDuringStreaming === true,
});
```

If context is absent (e.g. MCP direct call), skip preview/replay and commit synchronously after validation.

- [ ] **Step 5: Run tool and contract tests**

```bash
npm test -- --run src/lib/tools/drawVector/__tests__/drawVector.test.ts src/lib/__tests__/toolContract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit frontend tool support**

```bash
git add src/lib/tools/drawVector/index.ts src/lib/tools/drawVector/__tests__/drawVector.test.ts src/lib/toolRegistry.ts src/lib/__tests__/toolContract.test.ts
git commit -m "feat(ai): commit streamed vectors as native paths"
```

---

### Task 7: Observe partial tool parts and own cleanup in `useDesignChat`

**Repository:** `pen-editor`

**Files:**
- Create: `src/hooks/streamingVectorToolParts.ts`
- Modify: `src/hooks/useDesignChat.ts`
- Modify: `src/hooks/__tests__/useDesignChat.test.ts`

**Interfaces:**
- Produces: `extractStreamingVectorInputs(messages): StreamingVectorInput[]`
- Consumes: preview controller/store and optional `ToolExecutionContext`
- Preserves: final `onToolCall` execution and automatic continuation exactly once

- [ ] **Step 1: Add a failing delayed-delta hook test**

Stream SSE chunks in separate timed enqueues:

```ts
{ type: "tool-input-start", toolCallId: "vector-1", toolName: "draw_vector" }
{ type: "tool-input-delta", toolCallId: "vector-1", inputTextDelta: '{"name":"Leaf","commands":"M(10,10)\\n' }
{ type: "tool-input-delta", toolCallId: "vector-1", inputTextDelta: 'L(20,20)\\n' }
// Assert preview store now has 2 anchors and scene has no path.
{ type: "tool-input-delta", toolCallId: "vector-1", inputTextDelta: 'END()"}' }
{ type: "tool-input-available", toolCallId: "vector-1", toolName: "draw_vector", input: {...} }
```

Assert preview appears before the final chunk, `executeToolCall`/handler runs once, context is `{sessionId, toolCallId}`, tool output triggers one automatic continuation, and final preview clears.

Add separate tests for two sessions with the same tool call ID, explicit `stop`, registered abort controller, `chat.error`, and unmount. All must clear only the owning session.

- [ ] **Step 2: Run hook tests and verify RED**

```bash
npm test -- --run src/hooks/__tests__/useDesignChat.test.ts
```

Expected: new partial-preview assertions FAIL.

- [ ] **Step 3: Implement a pure typed-part extractor**

`streamingVectorToolParts.ts` should avoid assumptions about other tool parts:

```ts
export interface StreamingVectorInput {
  toolCallId: string;
  name: string;
  commands: string;
}

export function extractStreamingVectorInputs(messages: UIMessage[]): StreamingVectorInput[] {
  // inspect assistant parts where:
  // part.type === "tool-draw_vector"
  // part.state === "input-streaming"
  // partial input.commands is a string
}
```

Default a missing partial name to `"Vector"`; ignore missing/non-string commands. Deduplicate by toolCallId using the last occurrence.

- [ ] **Step 4: Integrate streaming observation and execution context**

Add an effect keyed by `chat.messages` and `sessionId` that calls `upsertStreamingVectorPreview` for extracted parts.

Change `executeToolCall` to accept optional context and pass it to `handler(args, context)`. In `onToolCall`:

```ts
const result = await executeToolCall(toolCall.toolName, toolCall.input, {
  sessionId,
  toolCallId: toolCall.toolCallId,
});
```

- [ ] **Step 5: Make every terminal path clear previews**

- In the registered abort listener, call `clearSession(sessionId)` before `chat.stop()`.
- Return a wrapped `stop` callback that clears, then calls `chat.stop()`.
- Add an effect that clears the session when `chat.status === "error"`.
- In hook cleanup, clear the session after unregistering the abort controller.
- Do not clear on ordinary `ready` because final handler owns commit-before-clear and an `ask_user` pause is not an error.

- [ ] **Step 6: Run hook and chat UI tests**

```bash
npm test -- --run src/hooks/__tests__/useDesignChat.test.ts src/components/chat/__tests__
```

Expected: PASS with no duplicate continuation requests.

- [ ] **Step 7: Commit chat integration**

```bash
git add src/hooks/streamingVectorToolParts.ts src/hooks/useDesignChat.ts src/hooks/__tests__/useDesignChat.test.ts
git commit -m "feat(chat): consume streaming vector tool input"
```

---

### Task 8: Cover the complete browser experience

**Repository:** `pen-editor`

**Files:**
- Modify: `src/main.tsx`
- Create: `e2e/ai-vector-streaming.spec.ts`

**Interfaces:**
- Consumes: full Tasks 3–7 feature
- Produces: browser evidence for preview-before-commit, final continuation/undo, and cancel cleanup

- [ ] **Step 1: Expose only the transient store in dev**

Inside the existing `import.meta.env.DEV` block:

```ts
import("@/store/aiVectorPreviewStore").then(({ useAiVectorPreviewStore }) => {
  (window as unknown as Record<string, unknown>).__aiVectorPreviewStore = useAiVectorPreviewStore;
});
```

Do not expose it in production.

- [ ] **Step 2: Write a failing delayed-stream Playwright test**

Use `ReadableStream`/SSE response chunks with real delays rather than one static body. First send `start`, `start-step`, `tool-input-start`, then two deltas that complete `M` and `L`. Pause on a test-controlled promise before sending the final delta and `tool-input-available`.

Before releasing final input, assert through `page.evaluate`:

```ts
expect(previewDraft.points.length).toBeGreaterThanOrEqual(2);
expect(Object.values(scene.nodesById).some(node => node.type === "path")).toBe(false);
```

Also sample a pixel region or assert the Pixi container labelled `ai-vector-previews` has visible children so the test proves rendering, not only store state.

Release final input; assert:

- preview store becomes empty;
- exactly one `Leaf` path exists;
- Layers shows `Leaf`;
- follow-up request contains `tool-draw_vector` with `output-available` and `success: true`;
- invoke `__historyStore.getState().undo()` and assert the path disappears with one call.

- [ ] **Step 3: Add the mid-stream Stop scenario**

Start a second delayed vector call, wait for two preview anchors, click Stop (or call the public chat stop control), then assert within one frame:

- preview store has no draft for the session;
- scene has no new path;
- history length/index did not change;
- the route stream was canceled/closed.

- [ ] **Step 4: Run focused e2e and verify GREEN**

```bash
npm run test:e2e -- e2e/ai-vector-streaming.spec.ts
```

Expected: both success and cancel tests PASS in Chromium.

- [ ] **Step 5: Commit e2e coverage**

```bash
git add src/main.tsx e2e/ai-vector-streaming.spec.ts
git commit -m "test(e2e): verify live AI vector drawing"
```

---

### Task 9: Run release gates and verify real-provider behavior

**Repositories:** `pen-editor-backend`, `pen-editor`

**Files:**
- Modify only if results uncover a defect: the smallest file owned by the failing task
- Record QA result in the PR description; do not commit API keys, raw `.env`, or model responses containing user data

**Interfaces:**
- Consumes: completed backend and frontend changes
- Produces: CI evidence and a per-model streaming compatibility matrix

- [ ] **Step 1: Run complete backend gates from a clean status**

```bash
cd /Users/daniilrozhkov/prj/pen-editor-app/pen-editor-backend
git status --short
npm run lint
npm test
npm run build
```

Expected: clean status except intentional commits; lint/test/build exit 0.

- [ ] **Step 2: Run complete frontend gates**

```bash
cd /Users/daniilrozhkov/prj/pen-editor-app/pen-editor
git status --short
npm run lint
npm test
npm run build
npm run test:e2e
```

Expected: all commands exit 0, including the cross-repository tool contract and vector e2e.

- [ ] **Step 3: Measure every selectable real model**

With backend/frontend dev servers using existing local environment configuration, ask each model for the same three-anchor filled vector. In browser devtools or temporary non-committed instrumentation, record:

| Model | First usable preview before final? | Delta pattern | Classification | Final node correct? |
|---|---:|---|---|---:|
| `<model id>` | yes/no | count and approximate sizes | live/bursty/buffered | yes/no |

Definitions:

- `live`: at least two usable preview updates before final input.
- `bursty`: one usable preview update before final input.
- `buffered`: no usable preview before final input; bounded replay runs.

Every model must create the same correct final path. A buffered classification is acceptable; incorrect final output is a blocker.

- [ ] **Step 4: Exercise failure cases manually**

For one live model and one buffered model verify: Stop mid-stream, network offline mid-stream, closing the chat tab, Undo after success, multiple simultaneous chat sessions, and a vector drawn inside an existing frame.

Expected: no orphan previews, no partial scene nodes, one undo per successful call, and session isolation.

- [ ] **Step 5: Review merge order and ship frontend promptly**

Confirm backend `main` already contains `draw_vector`, then merge frontend. Re-run frontend CI after merge and verify the contract job checks out the matching backend main. Do not leave the cross-repository contract gap open.

---

## Plan Self-Review Checklist

- Spec coverage: tool contract, native-only policy, genuine partial input, transient rendering, atomic commit, fallback replay, cleanup, concurrency, performance limits, cross-repo merge order, and provider matrix each map to Tasks 1–9.
- Type consistency: `ParsedVectorDraft`, `VectorParseResult`, `AiVectorPreviewDraft`, `ToolExecutionContext`, and composite preview keys retain the same names/signatures across tasks.
- No source task asks an executor to incrementally call `batchDesign` or mutate `sceneStore` for previews.
- Every behavior-changing task starts with a failing test and ends with focused verification and a repository-local commit.
- No placeholder implementation steps or unspecified “add tests/error handling” instructions remain.
