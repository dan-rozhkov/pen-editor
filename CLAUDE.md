# CLAUDE.md — pen-editor

## Commands

```bash
npm run dev       # Start Vite dev server
npm run build     # tsc -b && vite build (type-check + production build)
npm run lint      # ESLint on all files (0 errors expected — enforced in CI)
npm test          # Vitest unit tests
npm run test:e2e  # Playwright e2e smoke test (starts the dev server itself)
npm run preview   # Preview production build
```

CI (`.github/workflows/ci.yml`) runs lint + unit tests + build and the e2e job on every push to `main` and every PR.

## Testing

- **Unit tests** (Vitest + happy-dom) live in `src/**/__tests__/`. Tool handlers are tested against the real Zustand stores: call `resetStores()`/`seedScene()` from `src/test/fixtures.ts` in `beforeEach`, invoke the handler, assert on store state plus the returned string. `src/test/setup.ts` stubs the canvas 2D context (happy-dom has none; sceneStore measures text with it). Test files compile under `tsconfig.test.json` — a separate project so the strict app build (`tsc -b`) never sees test code or node types.
- **`useDesignChat`** is tested with a stubbed `fetch` that returns an AI SDK v6 UI message stream (SSE). `src/hooks/__tests__/useDesignChat.test.ts` is the reference for the chunk format (`data: {"type":"tool-input-available",...}`, `x-vercel-ai-ui-message-stream: v1` header, `data: [DONE]` terminator).
- **Tool-name contract**: `src/lib/__tests__/toolContract.test.ts` pins the `toolHandlers` name list and, when the sibling `../pen-editor-backend` checkout exists, imports its `src/ai/tools.ts` to assert the sets stay in sync (skipped otherwise). In CI the `contract` job checks out the backend's **`main`** at run time and sets `CONTRACT_REQUIRE_BACKEND=1`, so it cannot self-skip. It asserts both directions — every `penTools` entry has a handler here, and `FRONTEND_ONLY_TOOLS` is empty (`get_screenshot` was the lone exception until it regained a backend schema) — so a tool breaks the contract until both halves land, and this job is red for *every* push here while that gap is open. **Land a new tool's backend schema on backend `main` first, then merge the handler here**, back-to-back: that way this job passes on the first try. Handler-first fails your own push and needs a re-run after the backend lands.
- **`batch_get` search patterns are compiled through `src/lib/tools/namePattern.ts`**, which refuses patterns that nest a quantifier inside a quantified group (`(a+)+`) and anything over 200 characters. `batch_get` compiles a caller-supplied regex and tests it against every node name, synchronously: catastrophic backtracking freezes the tab for the *user*, and nothing downstream can stop it — the timeout in `executeToolCall` cannot preempt synchronous work, and this tool is deliberately off the serial queue. The check is a heuristic tuned to false-negative on purpose: it is shared with the chat agent, and wrongly rejecting an ordinary layer search (`^Button`, `Card \d+`) is a worse everyday outcome than missing an exotic hang.

- **E2E** (`e2e/`, Playwright, chromium only): stubs `/api/chat` and `/api/models` with `page.route` — no backend or LLM needed — and verifies message → streamed tool call → local execution (node lands in sceneStore and LayersPanel) → auto-continuation. `window.__sceneStore` is exposed in dev mode (`src/main.tsx`) for assertions. Keep e2e out of Vitest (`exclude` in `vitest.config.ts`) and out of `tsc -b` (own `e2e/tsconfig.json`).
- **Lint rules against flaky/sloppy tests**: `eslint.config.js` scopes `eslint-plugin-playwright`'s flat/recommended config to `e2e/**` (`no-wait-for-timeout`/`no-focused-test`/`no-skipped-test` — the last with `allowConditional: true` so `test.skip(condition, "reason")` still works — forced to `error`), and `@vitest/eslint-plugin`'s recommended config to `src/**/__tests__/**`/`src/test/**` (`no-conditional-tests`/`no-conditional-in-test`/`no-disabled-tests`/`no-focused-tests` forced to `error`). `src/test/assertions.ts` (`assertDefined`/`assertOk`/`assertErr`/`assertField`) replaces the `expect(result.ok).toBe(true); if (!result.ok) return;` guard-clause idiom with a real assertion + TS type predicate, so a discriminated-union-narrowing test body doesn't need an `if` at all.
- **Flaky-test visibility**: Vitest retries once under CI (`retry` in `vitest.config.ts`); `scripts/flakyReporter.ts` (a custom reporter — Vitest's built-in reporters don't expose retry counts anywhere actionable) records every test that only passed after a retry to `flaky-tests.json`, and `npm run test:flaky-summary` (`scripts/flaky-summary.mjs`) turns that into a `$GITHUB_STEP_SUMMARY` table in CI. Playwright's `reporter` in both configs is `["list", "html", ...(CI ? ["github"] : [])]` — the HTML report (with the trace viewer per retry attempt) is uploaded as a CI artifact.
- `get_screenshot` needs WebGL and cannot be unit-tested — e2e territory. PixiJS must never be initialized in unit tests.
- **Screenshot capture must await pending image-fill loads.** `applyImageFill`/`applyImagePaintStack` (`src/pixi/renderers/imageFillHelpers.ts`) load remote textures fire-and-forget — the Sprite is attached only in an async `onReady`, well after `withTexture` returns, so an agent that sets an image fill and immediately calls `get_screenshot` could extract a container with no sprite yet (worse for R2 URLs, which usually fall through the CORS retry chain to `/api/image-proxy`). Both `getScreenshot.ts` and `captureNodeScreenshot.ts` call `waitForPendingImageFills()` (`src/pixi/renderers/pendingImageLoads.ts`, a Pixi-free module-level registry, unit-tested directly) before `extract.base64`. The full order matters: `requestCanvasRender()` + a frame wait *first* (pixiSync flushes on its own rAF, and that flush is where `withTexture` registers the load — waiting before it would race an empty registry), then the wait, then a final render + frame settle so the newly-attached sprites are in the frame extract reads. Every frame wait is bounded and skipped outright when `document.hidden` — plain `requestAnimationFrame` never fires in a background tab, which is exactly where the MCP/desktop bridge drives this tool (same gotcha as `src/lib/h2dCapture/captureEmbed.ts`). The wait never rejects and always resolves by its timeout, so a genuinely broken image still degrades to today's blank-sprite screenshot instead of hanging the tool call. The Pixi container is re-resolved *after* the awaits, since a `fullRebuild` can destroy every container while we wait.

## Path Alias

`@/` maps to `src/` (configured in both `tsconfig.app.json` and `vite.config.ts`).

```ts
import { useSceneStore } from "@/store/sceneStore";
```

## Architecture

### Rendering Backend — PixiJS

The editor uses a single PixiJS renderer (Konva has been removed).

- Entry: `src/pixi/PixiCanvas.tsx`
- Node rendering: `src/pixi/renderers/` (per-node files: `frameRenderer.ts`, `textRenderer.ts`, etc.)
- State sync: `src/pixi/pixiSync.ts` (subscribes to Zustand stores, updates PixiJS containers)
- Viewport: `src/pixi/pixiViewport.ts`
- Interaction: `src/pixi/interaction/` (`dragController.ts`, `drawController.ts`, `transformController.ts`, etc.)
- Overlays: `src/pixi/SelectionOverlay.ts`, `src/pixi/OverlayRenderer.ts`
- Canvas UI hooks: `src/components/canvas/` (`CanvasOverlays.tsx`, `useCanvasFileDrop.ts`, etc.)
- Shaders (`@paper-design/shaders`): any node may carry a `shader?: ShaderConfig` (a curated `@/lib/shaders/registry` kind + preset + params). Shaders render **inside Pixi**: `@/lib/shaders/shaderRaster` bakes a static frame (`speed: 0`, `preserveDrawingBuffer: true`) of the `@paper-design/shaders-react` component to a `Texture` off-screen, and `src/pixi/renderers/shaderFillHelpers.ts` applies it as a masked `Sprite` on the node's container (above the background/image fill, below child nodes). Because the sprite lives in the scene graph, a shader node obeys z-order and can sit under/between other nodes. `renderers/index.ts` calls `applyShaderFill` on create and `shouldRebakeShader`-gated on update (shader-config or size change). Image-filter shaders (`category: "image"`) rasterize the node's own render via `@/lib/shaders/nodeRaster` as the shader input. Shaders are static (no in-canvas animation). A shader is added/removed via the Shader section (`ShaderSection`) in the properties panel. The pure display-list logic (`placeShaderSprite`/`shouldRebakeShader`/`destroyShaderFill`) is unit-tested; the WebGL bake (`shaderRaster`, `nodeRaster`) is not (like `get_screenshot`). The registry, prop-builder, and `ShaderSection` are unit-tested directly.

### Rendering performance (large documents)

The sync/culling layer is built to keep per-frame work O(changed), not O(document). Spec with measured results: `docs/superpowers/specs/2026-07-17-pixi-rendering-performance-design.md`.

- **Dirty-set diffing.** Scene mutators call `markNodesDirty(ids)` (`src/store/sceneStore/dirtyTracking.ts`) so `pixiSync`'s flush diffs only touched ids (`src/pixi/syncDiff.ts`). Any store mutation *not* preceded by `markNodesDirty` poisons the batch to a full scan — safe but slow, and this is deliberate: structural ops (`deleteNode`, group/ungroup, boolean, undo/redo) rely on that fallback. **Convention: call `markNodesDirty` *inside* the `set()` updater, after all no-op guards, right before returning changed state** — zustand skips subscriber notification on a same-reference return, and marking before the guard leaks the armed flag into the next unrelated mutation (see `basicMutations.ts` comments). Dev builds cross-check dirty vs full diffs and `console.warn` on mismatch (disable: `localStorage pen.diffCheck=off`).
- **Spatial-index culling + hit-test pruning.** `src/pixi/cullingIndex.ts` (uniform grid over absolute rects, `src/pixi/spatialGrid.ts`) replaces full-tree walks; `updateCulling` applies visible-set *diffs*. The index stores **store coordinates** — live layout sizes diverge for auto-layout `fit_content` frames, which is why hit-testing (`hitTesting.ts`) never prunes `line`/`connector`/fit_content-frame roots and the raster cache excludes fit_content frames. Extending that stored-vs-live divergence to a new node type/sizing mode means extending those exclusion lists.
- **Raster cache** (Figma-tiles analogue): `src/pixi/rasterCacheManager.ts` + pure decision logic in `rasterCache.ts`. Quiet (≥500ms), cold, size-bounded top-level frames get `cacheAsTexture` at a resolution bucket derived from `zoom × devicePixelRatio`. On by default; kill switch `localStorage pen.rasterCache=off` + reload. Eviction is synchronous-before-mutation (`onFlushStart` in the flush; that ordering is the fix for the historical stale-texture bug that once got `cacheAsTexture` disabled). **Invariant: any code that mutates Pixi containers *outside* a store flush must call BOTH `requestCanvasRender()` and `rasterCacheManager.onDirectContainerMutation(ids, state)`** — theme recoloring and the auto-layout drag animator are the two existing cases; a new animator that skips the second call reintroduces frozen-texture bugs. Frames with culled descendants or in overview zoom are never cached (culled/hidden state must not get baked into textures).
- **Perf harness.** Dev-only `?perf=N` URL param seeds a synthetic N-node document (`src/dev/perfScene.ts`); `window.__perfStats.summary()` reports flush/culling frame times. `e2e/pixi-large-document-performance.spec.ts` enforces hard frame-time budgets in CI — if a change reintroduces O(N) work on a hot path, that spec fails.

### State Management — Zustand

All global state lives in `src/store/`. Key stores:

| Store | Purpose |
|---|---|
| `sceneStore` | Scene graph (nodes, tree structure) |
| `layoutStore` | Computed layout rectangles |
| `selectionStore` | Selected node IDs |
| `viewportStore` | Pan/zoom state |
| `historyStore` | Undo/redo |
| `dragStore` | Active drag operations |
| `variableStore` | Design variables/themes |
| `drawModeStore` | Shape drawing mode |
| `hoverStore` | Hovered node state |
| `chatStore` | AI chat state |
| `clipboardStore` | Copy/paste clipboard |
| `measureStore` | Measurement overlay |
| `pixelGridStore` | Pixel grid display |
| `smartGuideStore` | Snapping/smart guides |
| `themeStore` | Active theme |
| `uiThemeStore` | Editor UI theme |
| `canvasRefStore` | PixiJS canvas ref |

### Scene Graph & Layout

Nodes are stored as a flat map (`nodesById`) with parent-child references (`parentById`, `childrenById`, `rootIds`). The layout engine computes absolute positions/sizes from the tree. Node types: frames, text, rectangles, ellipses, paths, groups, lines, polygons, embeds, refs (component instances).

`sceneStore` is split into modules:
- `src/store/sceneStore/index.ts` — main store
- `src/store/sceneStore/complexOperations.ts` — multi-step mutations
- `src/store/sceneStore/instanceOperations.ts` — component instance logic
- `src/store/sceneStore/helpers/` — history, textSync, flatStoreHelpers, treeCache

### HTML → Design Conversion

Pasting/converting external HTML (e.g. `convertEmbedToDesign`) renders the markup in a hidden iframe and captures its computed layout via `src/lib/h2dCapture/captureEmbed.ts` (wrapping the vendored `src/vendor/h2dCapture/` bundle), then converts the capture into scene nodes with `src/lib/h2dPaste/h2dToScene.ts`. `src/lib/htmlToDesign/` remains in use as the shared CSS-parsing library (colors, gradients, shadows, text properties) consumed by the h2d pipeline, and it still contains the legacy DOM-walk importer (`convertHtmlToDesignNodes`), which is unused by the store but kept for reference/tests.

### Desktop shell bridge

The Electron app (`../pen-editor-desktop`, its own repo) loads the deployed
editor and exposes `window.penDesktop = { onMenuCommand(cb), setDocumentTitle(title), registerMcpBridge?(handler) }`
from its preload. `src/lib/desktopBridge.ts` (called once in `main.tsx`)
dispatches received menu-command ids through the command-palette registry
(`getCommands()`), so **menu items in the desktop repo reference
`PaletteCommand.id` values** (`file-open`, `file-export-pen`,
`file-export-json`, `file-export-tokens`, `file-import-tokens`). Renaming or
removing one of these ids breaks the desktop menu — update
`pen-editor-desktop/src/main/menu.ts` (and its CLAUDE.md) in the same change.
`src/lib/__tests__/desktopMenuContract.test.ts` enforces this: the pinned id
list is checked against `getCommands()` on every run, and when the sibling
`../pen-editor-desktop` checkout exists it also builds the real menu template
and asserts the forwarded ids match. The `contract` CI job checks out the
desktop repo's **`main`** and sets `CONTRACT_REQUIRE_DESKTOP=1` so it cannot
self-skip — same both-directions, merge-order-sensitive deal as the tool
contract. On the web `window.penDesktop` is absent and both bridges below are
no-ops.

`registerMcpBridge` is the desktop shell's loopback-MCP entry point — see
"MCP bridge" below for the page-side half (`src/lib/desktopMcpBridge.ts`) and
`../plans/desktop-mcp-bridge.md` for the full cross-repo design (handshake,
token, tab routing, security).

### MCP bridge

Two independent transports route external MCP calls into the same
`toolHandlers`/`executeToolCall` path the built-in chat uses. Both share a
transport-agnostic dispatch core, `src/lib/mcpDispatch.ts`
(`createToolDispatcher({ send })`): the unknown-tool → `tool_error` branch,
plus a per-dispatcher queue that keeps one transport's outcomes in the order
its calls arrived.

Mutual exclusion *across* surfaces is a layer below, in
`src/lib/toolCallQueue.ts` (`runToolCall`). The scene-mutating handlers —
`batch_design` above all — build from a snapshot of `useSceneStore.getState()`
and commit a whole replacement `nodesById`/`childrenById`/`rootIds`, so two in
flight at once means the second commit discards the first's nodes. That was
once prevented by arrangement (one queue per transport, and the two bridges
are mutually exclusive), but chat, WebMCP and plugins are all reachable in one
editor tab at the same time.

`runToolCall` is called from `executeToolCall` itself, so chat, both bridges
and the WebMCP surface inherit it without any of them opting in — do **not**
wrap a call site in it again, or the inner call will wait on the queue the
outer one holds. Plugins are the one path that bypasses `executeToolCall`
(`pluginApi.ts`'s `runTool` calls the handler directly, for its own allow-list
and Dev Mode gate), so they call `runToolCall` explicitly.

**Read-only tools are not queued.** `UNSERIALIZED_TOOL_NAMES` lists them, and
anything absent from it is serialized — a new tool is safe by default, since
wrongly serializing a read costs latency while wrongly parallelizing a write
loses work. The list exists because one global queue otherwise couples
transports that share nothing: `get_screenshot` in a backgrounded tab (where
`rAF` never fires) burns its whole timeout, and would stall unrelated traffic
for that window. The timeout starts *inside* the queued task, so a call that
waited still gets its full budget.

`executeToolCall` itself already never
rejects — a throwing handler resolves to a JSON `{"error": "..."}` string —
so a dispatcher failure always surfaces as a normal *outcome*, not a broken
queue.

- **WebSocket bridge** (`src/lib/mcpBridge.ts`, `McpBridge`): connects this
  tab to the backend's `/api/mcp/ws` (started once from `main.tsx` iff
  `VITE_MCP_WS_TOKEN` is set) so external MCP clients reach the editor over
  the network. See `pen-editor-backend/CLAUDE.md`'s "MCP server" section and
  `pen-editor-backend/docs/superpowers/specs/2026-07-23-mcp-server-design.md`
  for the full design.

  **`VITE_MCP_WS_TOKEN` is baked into the public JS bundle at build time —
  local/dev builds only. Never set it on a publicly deployed frontend build:**
  every visitor's tab would get the secret and silently register itself as a
  bridge session that anyone holding the token can drive.

- **Desktop IPC bridge** (`src/lib/desktopMcpBridge.ts`,
  `initDesktopMcpBridge`): registers this tab with the Electron shell's
  loopback MCP endpoint via `window.penDesktop.registerMcpBridge({ protocol,
  tools, onCall })`, guarded so it is a no-op on the web and on desktop builds
  predating this feature. `tools` is the MCP tool-name subset of
  `toolHandlers` (the 7 backend-bridged tools plus the 3 client-side static
  guideline tools), derived from `src/lib/mcpToolNames.ts` — the single
  source also imported by `toolContract.test.ts`'s `BRIDGED_MCP_TOOL_NAMES`/
  `STATIC_MCP_TOOL_NAMES`, so the two can't drift; `protocol` is a single
  integer bumped only when the call envelope itself changes — adding or
  removing a tool does not bump it. `onCall` routes through this bridge's own
  `createToolDispatcher` instance (the same serial-queue dispatch core the
  WebSocket bridge uses), so two overlapping `mcp:call` IPC messages cannot
  interleave scene mutations, and it first checks the call's tool name
  against the advertised `tools` allow-list — refusing anything outside it
  with `"Unknown tool: <name>"` before the call ever reaches
  `executeToolCall`/`toolHandlers` — so a shell bug or mismatched build can
  never reach a tool this bridge doesn't advertise. The resulting promise
  still resolves rather than rejects, matching `executeToolCall`'s contract.

**Only one bridge may be active at a time.** A dev bundle built with
`VITE_MCP_WS_TOKEN` and loaded inside the desktop shell would otherwise start
both — two transports advertising the same tab as their editor session, with
duplicated status reporting and two sockets to keep alive. (Interleaved scene
mutations used to be the headline reason too; `runToolCall` now rules that out
on its own, but the mutual exclusion is still the intended arrangement.)
`main.tsx` resolves this by ordering, not locking: it awaits `initDesktopMcpBridge()` settling before even importing
`mcpBridge.ts`, and `mcpBridge.ts`'s `startMcpBridgeIfConfigured()` checks
`desktopMcpBridge.ts`'s `isDesktopMcpBridgeActive()` and no-ops if the desktop
bridge already registered — the desktop bridge always wins.

Both bridges drive the same `src/store/mcpBridgeStore.ts`
(`off | connecting | connected`), shown as a coloured dot plus label in the
**File → Settings** submenu (`Toolbar.tsx`) — no UI change was needed to
support the desktop path. It is a plain `<div>`, not `DropdownMenuLabel`:
Base UI's label part throws unless wrapped in a `Menu.Group`, which crashes
the whole menu.

### WebMCP (in-page agents)

`src/lib/webmcp/` publishes the editor's agent-facing tools on the page's
model context, so an agent that can run JavaScript in the tab — the Chrome
extension, Playwright, CDP, the Electron shell — reaches them without the
WebSocket or desktop bridge. Started from `App.tsx` (not `main.tsx`), so it
exists only where a document does; `/` must keep the editor's module graph out
of its entry bundle, and this module statically imports all of it.

- **The API is polyfilled** (`polyfill.ts`). No stable browser ships WebMCP
  yet — Chrome 152 exposes neither `document.modelContext` nor
  `navigator.modelContext` — and Electron lags Chrome by definition, so
  waiting for it would mean shipping nothing. The polyfill installs **only**
  when the browser has none, and everything else talks to `getModelContext()`,
  which prefers the native object. When Chrome ships the API the polyfill
  stops installing itself and nothing else changes. It deliberately mirrors
  the native API's awkward parts (arguments as a JSON *string*; a handler's
  error message replaced by a generic "Tool invocation failed") — being nicer
  than Chrome would let client code depend on detail Chrome will never give.
- **Ten tools**, the same curated set as the desktop bridge
  (`DESKTOP_MCP_TOOL_NAMES`), of which two write to the scene: `batch_design`
  and `set_variables`. Nothing consequential is exposed —
  `publish_to_showcase` in particular is not, and `webmcpContract.test.ts`
  fails if it drifts in.
- **Schemas live in `schemas.ts`** because they must ship in the bundle, which
  makes them a second copy of contracts owned by the backend's zod shapes.
  `__tests__/webmcpContract.test.ts` imports the sibling backend checkout the
  same way `toolContract.test.ts` does and asserts the copy is *tighter*,
  never looser: no property the backend does not declare, nothing required
  the backend does not accept. `batch_design` is the one deliberate
  tightening — the backend shape carries three alias keys for models that emit
  the wrong name, and this surface publishes canonical `operations` alone.
- **A failed tool call comes back as a result, not a rejection.** A rejection
  loses its message — the WebMCP layer replaces it with a generic "Tool
  invocation failed", which the polyfill mirrors on purpose — so tool-level
  failures return `{isError: true, error, ...}` instead, MCP's own convention
  for the split. The handler's other fields ride along, which is what makes
  `batch_design`'s resume point (`completedOperations`, `truncated`) reach a
  caller that needs to continue a long script rather than restart it. Only
  protocol-level problems still throw: an unknown tool, or arguments that are
  not a JSON string.
- **Input is validated at execute time** (`validateInput.ts`, a small
  JSON-Schema subset) and unknown keys are *rejected, not stripped*: a closed
  schema whose runtime quietly accepts extras is a decorative contract. If the
  schemas ever outgrow that subset, replace the validator rather than
  extending it — one that ignores a keyword it does not understand is worse
  than none.
- **The read-only gate is the safety-critical part, and it is two-layered.**
  `sharedViewStore.ts` is explicit that tool handlers mutate the scene stores
  *below* every UI-level guard, so hiding entry points is the only real
  protection — and WebMCP is a new entry point. Mutating tools are therefore
  withheld from registration when the canvas is not editable, **and** refused
  again inside `execute`. Both are needed: registration alone races
  (`/c/:shareId` sets its flag from a parent effect while the editor mounts
  lazily underneath, and editability can change after registration), while
  refusal alone would advertise tools that always fail. Editability is read
  from the app's own rules — `isSharedView` plus `canEditScene(mode)`, the
  latter being what also covers `/app?view`, which never sets the shared-view
  flag. Note what each is worth: `isSharedView` is a real boundary (the
  viewer refuses to leave view mode — `keyboardCommands.ts:209`), while
  `?view` on your own document is a UI mode, not a security control — Escape
  exits it by design, and a synthetic `KeyboardEvent` can do the same. Gating
  on it is honesty about what the page currently is, not a defence.
  **The `startWebMcp()` effect in `App.tsx` is declared after the
  `?view` effect on purpose**: passive effects run in declaration order, so
  registering first would advertise the editing tools a moment before view
  mode is entered.
- **Registration re-runs on every editor mount, and the surface is torn down
  on unmount.** Neither is optional. Forking a shared canvas
  (`SharedCanvasBar`) navigates `/c/:shareId` → `/app` client-side, so a
  result memoized from the read-only mount would leave the forked, editable
  document advertising read-only tools for the rest of the tab session. In the
  other direction, browser Back to the showcase unmounts the editor while the
  tools stay published (nothing can unregister one), so `stopWebMcp()` marks
  the surface unowned and `execute` refuses everything until an editor mounts
  again.
- **On someone else's canvas, reads are narrowed to what the viewer can see**
  (`sharedViewRedaction.ts`). This answers a threat that needs no XSS: on
  `/c/:shareId` the read tools stay published, so anyone who can send a share
  link can write instructions into a document that a stranger's agent will
  read. The rule is provenance — an agent must see what the victim's screen
  can show — so hidden nodes keep only id/type/name (the layers panel shows
  those anyway) and embed/component source HTML is removed, since it is never
  rendered as text and is the densest hiding place in the format. Redaction is
  marked, never silent, or the agent would describe an embed as empty. **Its
  honest limit: it removes the invisible channels, not the inattentive ones** —
  text that is genuinely drawn, just far from the viewport, still reaches the
  agent, and only refusing to publish the tools at all would change that.
  `untrustedContentHint` does not help here; nothing enforces it.
- **A published tool's name cannot be silently taken over.** `registerTool`
  replaces by name (remounts, hot reload), so `polyfill.ts` requires a claim
  token to replace a name the page already claimed. This is not a defence
  against script that already runs in the page — that script can do worse
  directly — it exists because `getTools()` omits `execute`, which makes a
  substituted tool byte-identical to the real one for the agent, the one party
  with no way to detect it.
- `webmcp.e2e.json` at the repo root is the expectation manifest — risk class,
  annotations and a safe fixture input per tool. Nothing executes it; it is
  what a person checks a running editor against.

### The agent's self-improvement, seen from the frontend

The backend (v0.38.0+) lets the design agent keep per-user memory and write its
own skills. Everything here is the *visibility* half of that: the rule is that
the agent never changes itself invisibly. All of it is inert when the backend
has `MEMORY_ENABLED` / `SELF_SKILLS_ENABLED` off — the tools simply never
appear in a turn and the activity endpoint returns nothing.

- **`src/lib/userId.ts`** — `pen.userId`, an anonymous id generated once and
  kept in `localStorage`, sent in every `/api/chat` body by `useDesignChat`.
  It is what the backend scopes **memory** to. Not an account: another browser
  or a cleared storage is a different identity with empty memory. Learned
  **skills are global**, not scoped to it — a difference that surprises people.
- **In-turn chips** (`MessageList.tsx` → `MemoryToolIndicator` /
  `SkillToolIndicator`). `memory` and `skill_manage` are backend-executed, so
  they arrive as ordinary tool parts. **Neither ever throws**: a refused write
  (over capacity, ambiguous match, circuit breaker, a guard rejection) comes
  back as normal output carrying `ok: false`. So a chip is rendered *only* for
  a parsed, genuine success — anything else must fall through to
  `ToolCallIndicator`, which shows the output and therefore the error. Parse
  defensively; the output may be a JSON string, an object, or a shape nobody
  anticipated.
- **`useAgentActivityToast`** — the background review runs server-side *after*
  the stream closes, so the model cannot mention it. This schedules two delayed
  checks of `GET /api/memory/activity` per finished turn and toasts only when a
  `background_review` event wrote a **skill** (FIR-71: memory writes are never
  announced, whether alone or alongside a skill write — the cursor still
  advances past them, but they produce no toast). It reads by **event-id cursor** kept in `localStorage`, never a
  timestamp — the endpoint filters on Postgres `created_at`, so a browser clock
  a few minutes off would silently suppress or repeat every toast. A baseline
  against a server with no rows records a zero cursor: "checked, saw nothing"
  has to be distinguishable from "never checked", or the very first review is
  swallowed. The toast id is stable per event so parallel chat tabs collapse
  into one notification.

### User-authored skills (the Skills panel)

Three kinds of skill now exist and they are easy to confuse. **Curated** skills
are git-owned Markdown in the backend repo, read-only, listed by
`GET /api/skills`. **Learned** skills are the ones the agent writes for itself
(the section above) and have no frontend surface at all. **User** skills are the
Figma-style custom ones the user writes, uploads as a `.md`, or has the agent
draft — Postgres rows behind `/api/user-skills`, scoped to the same anonymous
`pen.userId` as memory, and the only kind the editor can create or edit.

- **`src/lib/userSkills.ts`** — the typed client, plus frontmatter parse and
  serialize for upload/export. Every function returns an `ApiResult` union and
  **never throws**, the same contract as `showcasePublish.ts`; the base URL
  comes from `resolveApiUrl` (`apiBase.ts`), never a hardcoded `/api`.
- **`src/store/userSkillStore.ts`** — modeled on `pluginStore.ts`: lazy
  idempotent `ensureHydrated` with a shared in-flight promise, write-through
  mutators, failures in `error` rather than exceptions. Two invariants worth
  keeping: an `error` status must **not** short-circuit hydration (a single
  failed request has to stay retryable — only success settles it), and
  `pendingUpdates` gates a skill's row while a write is in flight, or a
  double-clicked enable switch resolves out of order and leaves the toggle
  lying about state.
- **`available: false`** (the backend has no user-skills store configured) is
  not an error — it renders as "the feature is off here", distinct from a
  request that failed, which offers a Retry. Both live in `SkillsPanel.tsx`.
- **`SlashCommandMenu.tsx`** merges the user's *enabled* skills under "Your
  skills" alongside the hardcoded built-ins, so `/my-skill` is discoverable
  where every other skill already was. Only user skills are slash-invocable;
  the panel's built-in list is display-only.

### File Format

The editor reads/writes `.pen` files. These are accessed exclusively through the Pencil MCP tools — never read `.pen` files directly with file I/O.

### Analytics

Product analytics (PostHog) lives in `src/lib/analytics/` — `events.ts` (the
`AnalyticsEventMap` typed catalog, one entry per event, showcase events
included for the other agent instrumenting `src/components/showcase/**`),
`index.ts` (public API: `initAnalytics()`, `track()`, `isAnalyticsEnabled()`,
`capturePageview()`, `__resetAnalyticsForTests()`), `buckets.ts`
(`bucketLength()`), `sessionTiming.ts` (the `first_prompt_sent` timer), and
`RouteTracker.tsx` (mounted in `AppRouter.tsx`, fires `$pageview` on
pathname change).

- **No-op without a key.** `VITE_POSTHOG_KEY` unset (dev/test by default) ⇒
  `track()` never touches the network and posthog-js is never imported.
  `initAnalytics()` is called once, PROD-only, from `main.tsx`.
- **Lazy-loaded.** `initAnalytics()` dynamically `import()`s posthog-js so
  it's code-split out of the main bundle; events fired before that import
  resolves are buffered (capped, oldest dropped) and flushed in order.
- **NO PII EVER.** Event properties are enums, booleans, counts, or bucketed
  numbers only (`bucketLength()`) — never prompt text, document content,
  file names, node text, URLs of user assets, or any other user-typed
  string. `track()` swallows all errors; a broken analytics call must never
  break a user action.
- Distinct id is the same anonymous id as `src/lib/userId.ts` (`pen.userId`,
  also used for backend agent memory), passed via posthog-js's `bootstrap`
  option so the frontend and backend agree on one identity — without
  upgrading it to an "identified" (billed) profile (`person_profiles:
  "identified_only"`, autocapture/pageview/session-recording all off;
  explicit events only).
- **New events must be added to `AnalyticsEventMap` in `events.ts` first** —
  `track()` is typed against it, so an untyped event name is a compile
  error.

## Code Style

### Naming

- Components: **PascalCase** (`PixiCanvas.tsx`, `LayersPanel.tsx`)
- Hooks: **camelCase** with `use` prefix (`useNodePlacement.ts`)
- Stores: **camelCase** with `Store` suffix (`layoutStore.ts`)
- Utils: **camelCase** (`colorUtils.ts`)

### Imports

Order: React → third-party → `@/` aliases → relative imports.

### Styling

- **Tailwind CSS v4** with `@tailwindcss/vite` plugin
- `clsx()` for conditional classes, `tailwind-merge` for deduplication
- Theme tokens defined in `src/index.css` (e.g., `bg-surface-panel`, `text-text-muted`)

### TypeScript

Strict mode, `noUnusedLocals`, `noUnusedParameters`. Target ES2022.

## Key Directories

```
src/
├── App.tsx                    # Root component
├── main.tsx                   # Entry point
├── index.css                  # Tailwind + theme tokens
├── components/
│   ├── canvas/                # Canvas-level UI hooks and overlays
│   ├── chat/                  # AI chat panel components
│   ├── properties/            # Property panel sections
│   ├── ui/                    # Generic UI primitives
│   ├── LayersPanel.tsx
│   ├── LeftSidebar.tsx
│   ├── PropertiesPanel.tsx
│   ├── RightSidebar.tsx
│   ├── Toolbar.tsx
│   └── ...
├── pixi/                      # PixiJS rendering backend
│   ├── PixiCanvas.tsx         # Entry point
│   ├── pixiSync.ts            # Zustand → PixiJS sync
│   ├── pixiViewport.ts        # Viewport/pan/zoom
│   ├── OverlayRenderer.ts
│   ├── SelectionOverlay.ts
│   ├── interaction/           # Input handling (drag, draw, transform, etc.)
│   └── renderers/             # Per-node-type renderers
├── store/                     # Zustand stores
│   └── sceneStore/            # Scene graph store (split into modules)
├── hooks/                     # Custom React hooks
├── lib/                       # Tool registry, HTML→design conversion, h2d capture/paste, etc.
├── types/                     # TypeScript types/interfaces
├── utils/                     # Utility functions
└── assets/                    # Static assets
```
