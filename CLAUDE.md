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
- **Test duplication ratchet:** `npm run check:dup:tests` (`scripts/check-test-dup.mjs`, config `test-dup.config.json`) runs jscpd over unit tests and `e2e/` and fails if duplicated lines exceed `test-dup-baseline.json` — the prod `check:dup` ignores `__tests__`, so this is the only gate on test copy-paste. The baseline only goes down (`--update` never raises it). Before writing a test, reuse `src/test/`, neighbouring `__tests__/*Fixtures.ts(x)` and `e2e/support/*`; a third near-identical case → `it.each`, a second file with the same setup → shared helper. Helpers hide mechanics; `expect` stays in the test body unless the helper is named `expect*`. The script passes its own jscpd config on purpose: jscpd 5.x applies `.jscpd.json`'s `ignore` even to explicit paths and silently scans 0 files.
- **Flaky-test visibility**: Vitest retries once under CI (`retry` in `vitest.config.ts`); `scripts/flakyReporter.ts` (a custom reporter — Vitest's built-in reporters don't expose retry counts anywhere actionable) records every test that only passed after a retry to `flaky-tests.json`, and `npm run test:flaky-summary` (`scripts/flaky-summary.mjs`) turns that into a `$GITHUB_STEP_SUMMARY` table in CI. Playwright's `reporter` in both configs is `["list", "html", ...(CI ? ["github"] : [])]` — the HTML report (with the trace viewer per retry attempt) is uploaded as a CI artifact.
- `get_screenshot` needs WebGL and cannot be unit-tested — e2e territory. PixiJS must never be initialized in unit tests.
- **Screenshot capture must await pending image-fill loads.** `applyImageFill`/`applyImagePaintStack` (`src/pixi/renderers/imageFillHelpers.ts`) load remote textures fire-and-forget — the Sprite is attached only in an async `onReady`, well after `withTexture` returns, so an agent that sets an image fill and immediately calls `get_screenshot` could extract a container with no sprite yet (worse for R2 URLs, which usually fall through the CORS retry chain to `/api/image-proxy`). Both `getScreenshot.ts` and `captureNodeScreenshot.ts` go through the shared `extractPixiNodeDataUrl()` (in `captureNodeScreenshot.ts`), which calls `waitForPendingImageFills()` (`src/pixi/renderers/pendingImageLoads.ts`, a Pixi-free module-level registry, unit-tested directly) before `extract.base64`. The full order matters: `requestCanvasRender()` + a frame wait *first* (pixiSync flushes on its own rAF, and that flush is where `withTexture` registers the load — waiting before it would race an empty registry), then the wait, then a final render + frame settle so the newly-attached sprites are in the frame extract reads. Every frame wait is bounded and skipped outright when `document.hidden` — plain `requestAnimationFrame` never fires in a background tab, which is exactly where the MCP/desktop bridge drives this tool (same gotcha as `src/lib/h2dCapture/captureEmbed.ts`). The wait never rejects and always resolves by its timeout, so a genuinely broken image still degrades to today's blank-sprite screenshot instead of hanging the tool call. The Pixi container is re-resolved *after* the awaits, since a `fullRebuild` can destroy every container while we wait.

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
- **Raster cache** (Figma-tiles analogue): `src/pixi/rasterCacheManager.ts` + pure decision logic in `rasterCache.ts`. Quiet (≥500ms), cold, size-bounded top-level frames get `cacheAsTexture` at a resolution bucket derived from `zoom × devicePixelRatio`. On by default; kill switch `localStorage pen.rasterCache=off` + reload. Eviction is synchronous-before-mutation (`onFlushStart` in the flush; that ordering is the fix for the historical stale-texture bug that once got `cacheAsTexture` disabled). **Invariant: any code that mutates Pixi containers *outside* a store flush must call BOTH `requestCanvasRender()` and `rasterCacheManager.onDirectContainerMutation(ids, state)`** — theme recoloring and the auto-layout drag animator are the two existing cases, and renderers that attach content asynchronously (an image-fill texture finishing its load in `imageFillHelpers.ts`'s `withCachedTexture`) do it via `notifyAsyncContainerMutation(container)` (`src/pixi/renderers/asyncContainerMutation.ts`, handler installed by `pixiSync`); a new animator that skips the second call reintroduces frozen-texture bugs. Frames with culled descendants or in overview zoom are never cached (culled/hidden state must not get baked into textures).
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

Nodes are stored as a flat map (`nodesById`) with parent-child references (`parentById`, `childrenById`, `rootIds`). The layout engine computes absolute positions/sizes from the tree. Node types: frames, text, rectangles, ellipses, paths, groups, lines, polygons, embeds, connectors.

`sceneStore` is split into modules:
- `src/store/sceneStore/index.ts` — main store
- `src/store/sceneStore/complexOperations.ts` — multi-step mutations
- `src/store/sceneStore/helpers/` — history, textSync, flatStoreHelpers, treeCache

### HTML → Design Conversion

Pasting/converting external HTML (e.g. `convertEmbedToDesign`) renders the markup in a hidden iframe and captures its computed layout via `src/lib/h2dCapture/captureEmbed.ts` (wrapping the vendored `src/vendor/h2dCapture/` bundle), then converts the capture into scene nodes with `src/lib/h2dPaste/h2dToScene.ts`. `src/lib/htmlToDesign/` remains in use as the shared CSS-parsing library (colors, gradients, shadows, text properties) consumed by the h2d pipeline, and it still contains the legacy DOM-walk importer (`convertHtmlToDesignNodes`), which is unused by the store but kept for reference/tests.

### Embed entry: the MCP Apps canvas widget

A second Vite entry (`embed.html` → `src/embed/main.tsx`, same build) is the editor packaged as an **MCP Apps widget**: the backend's `open_canvas` tool returns a `ui://` resource whose HTML shell loads `${APP_ORIGIN}/embed/loader.js` inside a host's sandboxed iframe (different origin, no router, no `/app`). Embed mode = canvas + the real `LeftRail` (every section except Agents, via `hiddenSections`) + `LeftSidebarBase` (the app's `LeftSidebar` is a thin wrapper injecting the Toolbar and the Agents chat pane, so the embed never imports them) + properties (open by default) + a slim top bar (`src/embed/EmbedApp.tsx`); the host's `hostContext.theme` (else prefers-color-scheme) drives the whole UI through `setUIThemeTransient` (`uiThemeStore`: applies the `.dark` class without saving the user's stored preference); it must never import the router, chat, showcase, auth, analytics, WebMCP, desktop bridge or the token/cookie bridge (`src/embed/__tests__/boot.test.tsx` fails if the router/chat/WebMCP get into its graph).

- **`vite/embedLoader.ts`** emits the one NON-hashed file, `dist/embed/loader.js`: it injects the hashed entry CSS and `import()`s the hashed entry JS using URLs derived from the loader's own `import.meta.url` (never `location`), and publishes that base as `globalThis.__SIDEFORM_ASSET_BASE__`. `renderBuiltUrl` in `vite.config.ts` makes lazy-chunk/CSS preload URLs honour that global (unset everywhere else, so `/` and `/app` resolve exactly as before). The widget is loaded cross-origin, so `/assets/*` and `/embed/*` must be served with `Access-Control-Allow-Origin` — configured in the Render static-site headers (a `public/_headers` file does nothing there); the injected stylesheet links carry `crossorigin=anonymous`.
- **`src/embed/hostBridge.ts`** is the only code that talks to the host (ext-apps `App`, postMessage transport on `window.parent`): reads the `{ticket, wsUrl}` from the `open_canvas` tool result (`_meta["sideform/bridge"]`), starts `McpBridge.forTicket(...)`; a ticket is single-use, so on a dropped socket it calls the app-only `sideform_bridge_ticket` tool via `callServerTool` (`_meta` first, structuredContent fallback) and reconnects with backoff. Expand → `requestDisplayMode("fullscreen")`; "Open in Sideform" → the anonymous share API, then host `openLink` (link built from the bundle's own origin, not the sandbox's).
- **`McpBridge` ticket mode** (`McpBridge.forTicket`): connects to `${wsUrl}?ticket=…`, same hello/ack/go protocol, but never reconnects itself — it reports `onOpen`/`onClose` and the owner mints a new ticket.
- The scene autosaves to `localStorage` key `sideform.embed.doc` (try/catch everywhere; sandboxes may deny storage). The embed API base comes from the same `VITE_*` env as the app — a same-origin (empty) base cannot work from a sandbox, so sharing is disabled there.

### Chatless mode (`/app?chat=off`)

The full editor minus the agent chat — not the embed entry. The desktop app puts the chat in its own always-visible left panel and loads the canvas as a tab of `/app?chat=off`. The one predicate is `isChatDisabled()` (`src/lib/chatMode.ts`): `chat=off|0|false`, or `window.penDesktop?.agentLayout === true` (the desktop editor-tab preload exposes it when the agent layout flag is on, so a reload that dropped `?chat=off` stays chatless). It is sticky only once seen ON — while false the URL is re-read on every call, so a store imported early on `/` cannot freeze the mode before a client-side navigate to `/app?chat=off`; once ON it survives `navigate("/app")` (query dropped, mode kept) until a full reload without the flag. It hides the Agents rail section (`leftSidebarStore` also refuses to land on `"agents"`, so the pane, `ChatPanelContent` and `useDesignChat` never mount), hides every canvas entry point that starts a chat **unless a canvas host is running** (see below): the on-canvas agent buttons through ONE gate — `AgentComposerButton` returns null when `!canLaunchAgent()` (`FrameAgentButton`, `EmbedAgentButton`, `EmbedElementAgentButton` all render through it; do not add call-site gates) — plus the `EmbedPromptHost` input (an empty embed keeps its dashed placeholder, `composer={canLaunchAgent}`) and comment "Send to agent"; the OpenCode palette command (the chat model picker's BYOK flow) stays hidden. **The one entry-point predicate is `canLaunchAgent()` (`src/lib/canvasLink/agentLaunch.ts`) = chat enabled (`!isChatDisabled()`) OR the canvas host is running** (chatless + desktop link); React components use `useCanLaunchAgent()` because the host registers after the first render. Plain chatless mode without a host (`/app?chat=off` in a browser) keeps the entry points hidden and the launch helpers return false. **`loadModels()` is NOT skipped**: the same response carries image-ops capabilities (`canRemoveBackground`, `canVectorize`) and vision metadata used by non-chat tooling; `reconcileModels` only touches chat-store ids. **The showcase agent prompt** (`pen:showcase-agent-prompt:v1`) is NOT consumed in plain chatless mode; with a running canvas host `launchShowcaseAgentChat` forwards it once as a `launch` and removes it (`App.tsx` retries on `subscribeCanvasHost`, so a host that registers later still gets it). WebMCP, the MCP bridges, plugins and the tool handlers stay on so an external driver can still operate the canvas. **Any new agent entry point (button, palette command, context-menu item, deep link, chat-only startup fetch) must be gated on `canLaunchAgent()` (or `isChatDisabled()` for chat-only work with no panel equivalent); never parse the URL ad hoc.**

### Canvas link — canvas side

In the desktop agent layout a chatless tab (`isChatDisabled()`) with `window.penDesktop?.canvasHost` registers as a canvas host: `App.tsx` has one effect calling `maybeStartCanvasHost()` (`src/lib/canvasLink/canvasHost.ts`; gate = chatless AND bridge AND NOT the shared viewer; edit/view/present toggles do NOT restart the host, which refuses mutating calls/frames/place-node itself via `canMutateScene()` from `lib/webmcp/registerTools.ts`, the one editability rule; stop (unmount / viewer) calls `bridge.unregister()`, clears the adapters' `"canvas-link"` session and abandons open streams; no read tools are ever published on a shared canvas because the host does not start there). It serves the agent panel per `docs/canvas-link.md`: `stream` frames go through an `AppendDecoder` per `toolCallId` into `getStreamingToolAdapter(tool).onFrame` (session `"canvas-link"`), a seq gap answers `resync`, `stream-end` "abandoned" runs `onAbandon` (also after "complete": the tool name is kept until the matching `call`), `call` runs `executeToolCall(..., "canvas-link")` with `callId === toolCallId` (the invariant that hands the streamed state to the handler: one undo entry, nodes once; the stream entry is kept until the handler really starts, signalled by `ctx.onStart`, which also posts `started` to the panel; a call that ends without running rolls its stream back via `onAbandon`) and `{timeoutMs}` as `executeToolCall`'s per-call budget override (5th arg; the ONE timeout, started inside the queue; a call whose signal aborted before its queued task starts never runs), `cancel` aborts the signal, a main-made `panel-gone` aborts every call silently and abandons every stream, a still-running duplicate `callId` is ignored, mutating calls (any tool outside `UNSERIALIZED_TOOL_NAMES`) and frames are refused when the canvas is not editable, `place-node` runs `placeNodeOnCanvas`, `context-request` answers `JSON.stringify(buildSceneContext({model}))` (the SCENE part only; the panel appends chat-side `likedReferences` as the last key), and the host publishes the composer's selection chips as `selection` (coalesced, deduped, once after register and on `selection-request`; see the panel side). **Agent entry points:** `deliverAgentLaunch(payload)` (`canvasLink/agentLaunch.ts`) posts `{kind:"launch", launchId, payload:{text, images?}}` through the running host (false without one). `launchNodeAgentChat` (and its wrappers `launchFrame/Embed/EmbedElementAgentChat`), `sendCommentToAgent` and `launchShowcaseAgentChat` call it instead of launching locally when `isChatDisabled()`; every local helper makes a NEW chat, and so does the panel. No entry point selects a node or sends node ids; the tab's own selection reaches the panel through its `canvasContext`. `place-node` needs a string `type`, generates a missing `id`, errors on an existing one. `buildSceneContext` (`canvasLink/sceneContext.ts`) is the scene part of `canvasContext`, shared with `buildCanvasContext` in `useDesignChat.ts`, which only adds chat-side `likedReferences`; keep key order stable (prompt cache). The message's `timeoutMs` replaces the tool's default budget; a handler that ignores its abort signal still holds the tool queue until `executeToolCall`'s own timeout.

### The `/agent` route (chat without a canvas)

`/agent` (`src/routes/AgentPage.tsx`, lazy in `AppRouter.tsx`) is the Agents chat on its own: `ChatPanelContent` (chat list + open chat) at full viewport height, in `EditorProviders` (TooltipProvider + Toaster, shared with `App`), meant for a narrow fixed panel in the desktop shell (300-600 px). It must NOT import `App.tsx` or mount `PixiCanvas` / a pixi.js `Application` (no `<canvas>`): the chat's tool registry legitimately reaches some `src/pixi/` modules (e.g. `autoParentPlacement`), so the invariant is "no canvas is mounted", not "no pixi import"; `AgentPage.test.tsx` mocks `PixiCanvas` and `pixi.js`'s `Application` to throw. It is **gated**: it renders only where `isAgentPanelHost()` (`src/lib/agentPanel.ts`) is true (`window.penAgentPanel`, exposed by the desktop agent-panel preload, or a dev build) and otherwise redirects to `/app`, because tool calls would hit an empty in-memory scene and the work would vanish. `startBridges()` (desktop menu/MCP bridges, WS bridge) returns early on this route so a canvas-less page never registers as an editor/MCP target. Chat visibility is passed as `<ChatPanelContent isVisible>`; it never writes the global `leftSidebarStore` (that would leak into `/app` on SPA navigation). Model bootstrap is the shared `useChatBootstrap()` hook (also used by `App`), and `ChatPanelContent` hides the "Expand panel" header button (`hideExpandToggle`).

#### Canvas link — panel side

In the desktop panel (`window.penAgentPanel.version >= 2` with `canvas`) the chat has no scene, so canvas tools run in a canvas tab (`/app?chat=off`) over the link in `docs/canvas-link.md`. `src/lib/canvasLink/panelClient.ts` is the React-free client (bridge and clock injected; tested against `__tests__/fakeCanvasBridge.ts`); `panelRuntime.ts` holds the singleton and the seams `useDesignChat` calls, all inert outside the panel (`isPanelCanvasLinkActive()` = `isAgentPanelHost()` plus a canvas bridge, so a dev `/agent` without the preload keeps the old local behaviour). Tool placement is `canvasTools.ts` (`runsInCanvasTab`): `ask_user`, `analyze_image`, `open_canvas_tab`, the static guideline tools and every `browse_*`/`qa_*` stay in the panel, everything else goes to the tab.

- **Seams in `useDesignChat`** (keep them few): `onToolCall` -> `panelCallTool` (per-tool `getToolCallTimeoutMs` as `timeoutMs`; the taste check / `addToolOutput` flow is unchanged); the streaming effect -> `panelForwardFrame` (instead of the local adapter); both abandon paths -> `panelEndStream(..., "abandoned")` (completion is `callTool` closing the stream); the transport `body` -> `withPanelCanvasContext` (async; `DefaultChatTransport` awaits `body`).
- **Binding** is per chat (`sessionId`) and has ONE path, `PanelClient.establish` (implicit `bind`, `bindExplicit` for `open_canvas_tab`, `bindTo` for `launch`): binds of one chat run one after another (`binding$` is the queue), so concurrent binds never overwrite each other half-way, but only the implicit one (a canvas tool frame) reuses a binding another bind just made; an explicit bind honors its own target (`open_canvas_tab` "new" ALWAYS opens a fresh tab, `bindTo` returns null unless the result is exactly the asked tab); abort and latch are checked BEFORE `activateTab`/`openTab`, and once `openTab()` resolved the tab is bound and the call succeeds even if aborted. After a switch the new tab's context is prefetched (`primeContext`, 2 s, with the chat's own model via `resolveSessionModel`) and, if that fails, `{}` is held (see `canvasContext`). Implicit rule: one tab -> it, several -> first in the list, none -> `openTab()`, bound with the `{tabId, registrationId}` it resolves with (never a registration looked up in the tab list, which may lag). The FIRST streamed frame of a canvas tool call binds/opens, frames arriving while `openTab()` is pending are buffered and flushed in order. `tab-gone` is a latch per `tabId`+`registrationId`: pending calls fail at once with `{"error":"The canvas tab was closed."}`, its streams end, nothing is sent to it again (a late frame never reopens a stream), the binding AND the chat's remembered `canvasContext` are cleared (a main `error` for a call/context request whose tab is no longer listed latches it too, so the next call rebinds); a reloaded tab (new `registrationId`) is usable. A `resync` makes the encoder send a "full" frame.
- **`launch`** (tab -> panel, `PanelClient` `onLaunch` -> `handleLaunch` in `panelRuntime.ts`): creates a NEW chat (inactive until the bind worked, so a refused launch keeps the user's active chat), BINDS it to the sending tab with `PanelClient.bindTo(sessionId, tabId)` (registration looked up in the refreshed tab list; replaces any binding), ACKS, primes the tab's context (`primeSession`, up to 2 s) and only then queues `{text, images}` through the normal `queueLaunchPayload` -> `consumeLaunchPayload` path, so the first request already carries that tab's `canvasContext` (selection). Each `launchId` is handled once and ALWAYS answered with a `launch-ack` (`error` = refused): a tab that is unlisted/latched (`probeTab`) is refused before any chat is created. `panelRuntime` also calls `forgetSession` for every chat that leaves `chatStore`, so the client's per-chat maps do not leak. The `PanelClient` is created when `/agent` mounts (`startPanelRuntime()` in `AgentPage`), not on the first chat request, so a launch before any chat activity is received. The canvas side (`agentLaunch.ts`): the ONE dispatcher is `launchAgentChat` (local chat OR `deliverAgentLaunch`; neither selects a node), `deliverAgentLaunch` waits 8 s for the ack (`LAUNCH_ACK_TIMEOUT_MS`; toast "The agent panel did not respond." and `false` otherwise; a launch that could not be posted at all, host stopped or `bridge.post` threw, fails at once with "Could not reach the agent panel."), the showcase prompt stays in sessionStorage until the ack and `launchShowcaseAgentChat` retries an unacked launch 3 times, 5 s apart, while the host runs, and `isCanvasHostRunning()` is true only after `register()` succeeded.
- **`canvasContext`**: requested from the bound tab (2 s timeout) with this chat's `likedReferences` appended as the LAST key of the JSON (parse + add + stringify, deterministic). An unbound chat binds PASSIVELY to the first registered tab for it (never `openTab()`), so a new chat with an existing tab sends that tab's context on its first message. **When a request for it fails** (timeout, error, empty) the client sends the LAST good context that chat received, so the prompt does not flap. **After a bind to a new tab (`open_canvas_tab`, `launch`) the chat's context is primed once from that tab (the old tab's context is never kept: its ids are stale); if the prime fails, the held value is `{}` and the field is still sent (`{}` plus `likedReferences`), so the pointer block does not flip.** **A chat with no scene context (no canvas tab at all, a gone tab with nothing newer) sends NO `canvasContext` field**, or just `{"likedReferences":[...]}` (read from `useChatStore` via `canvasLink/likedReferences.ts`, same source as `buildCanvasContext`) when it has liked references: the backend then renders no `<canvas_context>` message and no pointer block in the system prompt (`canvasContextDelivered` in `chatTurn.ts`), which is saner than presenting the panel's empty scene as the design. Cost: one system-prompt change when the first context starts to arrive.
- **Selection chips**: the composer chips (`useSelectionContext` / `useEmbedElementContext`, display only, no actions) read `usePanelSelection(sessionId)` in the panel: `PanelClient` keeps the tab's latest `selection` snapshot per `tabId` (cleared on `tab-gone`), `selectionFor(sessionId)` = the bound tab, else the first listed tab, and it asks tabs it has no snapshot for with `selection-request` only while a chip consumer is subscribed. `/app` keeps reading its own stores (the hooks only switch when `isPanelCanvasLinkActive()`).
- **Browser tools** run in the panel on `window.penAgentPanel.browser` (same shape as `penDesktop.browser`): `desktopBrowserBridge()` in `tools/browser/bridge.ts` is the one place that picks it, so `isDesktopBrowserAvailable()`, `CLIENT_CAPABILITIES` (`desktopBrowser`, `browseIsolation`, `browseAssert`) and isolated QA sessions follow. Their one scene write, `placeNodeOnCanvas`, is redirected (`setPlaceNodeRedirect`, installed by `panelRuntime`) to a `place-node` request: the node goes without position, `options` = `{x?, y?, size}` (`x`/`y` only as a pair); an error answer throws, an aborted call returns `undefined`. The browse handlers pass `context.sessionId` and the tool's `signal` to `placeNodeOnCanvas`, so a background chat's capture lands in ITS bound tab (a caller without a session falls back to the active chat). A placement the tab answered is returned even if the signal aborted meanwhile (the node exists). `browse_screenshot` reports a failed placement as `placeError` next to its capture; `browse_capture` reports it as its error.
- **Timeouts and analytics**: a call's `timeoutMs + 2 s` budget starts when the tab posts `started` (its queued task began the handler), so queueing behind another call is not charged; before `started` only a 10 min safety net (`PRE_START_TIMEOUT_MS`) applies. A timeout posts `cancel`, like an abort. `agent_tool_executed` for a call that reached the tab comes ONLY from the tab's `executeToolCall` (source `canvas-link`); the panel reports (`panelRuntime.trackCanvasCallFailed`, source `canvas-link`, `error_kind` `canvas_link_{tab_gone,main_error,timeout,bind_failed}`) only failures that never got the tab's answer. `executeToolCall`'s per-call budget uses a small cache of executors keyed by budget, because `@sideform/agent-harness`'s `timeoutMs(toolName, input)` does not receive the execution context (harness follow-up: pass `ctx`, then drop the cache).
- **Jev taste check runs in the tab.** The touched-embed registry (`tasteCheckRegistry`) is filled by the `batch_design`/`edit_embed_html` handler in the canvas tab's process, so `useDesignChat` sends `brief` (the last user message text) with those two calls (not after a Stop) and `canvasHost`'s `call` case runs `runTasteCheckForToolCall` after `executeToolCall` (fail-open, call's abort signal), returning the merged result; the panel's own `hasTouchedEmbeds` branch stays false for link calls. A call with a `brief` waits `TASTE_CHECK_MARGIN_MS` (9 s) longer in the panel.
- **A tab that closes while a tool's INPUT still streams**: `latchRegistration` reports each live stream it drops (`onStreamLost` -> `subscribePanelStreamLost(sessionId, cb)` in `panelRuntime`); `useDesignChat` then stops the turn (`clearStreamingToolSession` + `chat.stop()`) and, only after the stop settled, writes `TAB_CLOSED_ERROR` as that call's output (`turnStoppedRef` blocks auto-continuation). The client also remembers the lost `toolCallId`: a later `callTool` for it answers `TAB_CLOSED_ERROR` instead of binding another tab.

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

### browse_task loop (`@sideform/browser-agent`)

The browse_task loop (snapshot -> `/api/browse/step` -> perform, sub-goal
planning, the action cache `pen.browseActionCache.v1`, loop guard, commit-label
rules) is NOT in this repo: it comes from `@sideform/browser-agent/loop`
(`github:dan-rozhkov/browser-agent#v0.2.1`, public MIT repo, no token needed;
`npm ci` builds its `dist/` through its `prepare` script). Renovate (`renovate.json`) opens bump PRs for `@sideform/browser-agent` only. Patch bumps automerge on green CI. Minor bumps are breaking in 0.x and need a human. Here `src/lib/tools/browser/browseTask.ts` is only
the `ToolHandler` glue; `backend.ts` builds the one `createHttpBackend`
(`apiFetch`: base URL and cookie resolved per request) that `browseTask`
and `browseAct` share. `window.penDesktop.browser` is typed as the package's
`BrowserBridge`. Loop tests and `commitLabelContract` live in the package.

### Accounts (Better Auth)

Optional sign-in (Google / email link / password); anonymous use is unchanged. Backend contract: Better Auth at `<backend>/api/auth`, `GET /api/auth-config` -> `{enabled, appOrigin?, google, emailEnabled}` (accounts count as enabled ONLY when `enabled` and `appOrigin` equals `window.location.origin`, trailing slash ignored; any other host serving this build, or a backend without `appOrigin`, behaves as `enabled:false`), `POST /api/account/claim-anon`.

- **Client**: `src/lib/auth/authClient.ts` (`better-auth/react` + `magicLinkClient`, `apiKeyClient` from `@better-auth/api-key/client`, `oauthProviderClient` from `@better-auth/oauth-provider/client`). Pin these to the backend's Better Auth version. The auth client chunk is lazy: `AuthMenu` / `AuthBootstrap` fetch `/api/auth-config` first and render nothing (never load the client) when accounts are off or the request fails.
- **Credentials rule**: every backend call goes through `apiFetch(path)` / `apiFetchUrl(url)` in `src/lib/apiBase.ts` (they set `credentials: "include"` ONLY after `loadAuthConfig()` resolved `enabled:true` — module flag in `apiBase.ts`; before that, or when accounts are off, no credentials); the chat transport resolves it the same way. The auth client always includes (it loads only when enabled). Never write `fetch(resolveApiUrl(...))` — `authPlumbing.test.ts` scans `src/` and fails on it.
- **Identity**: `src/lib/auth/authState.ts` mirrors the session (written by `SessionSync`). Request bodies/queries use `getRequestUserId()` / `requestUserIdParam()` (omitted while signed in; never MINTS an anon id while accounts are on and the session is unresolved — `peekActorId()` for analytics), never `getUserId()` directly; `getUserId()` stays the single owner of `pen.userId` (with `peekUserId`/`clearUserId`). First sign-in with a stored anon id -> `claimAnonymousData()` -> clear on 200/409 -> reload skills.
- **Routes** (lazy, `AppRouter.tsx`): `/sign-in` (`?next=` restricted by `safeNext`, `?error=`, `?token=` reset), `/consent` (OAuth query forwarded by the plugin; needs a session), `/account` (API keys, connected agents). Entry points: `AuthMenu` in the editor `Toolbar` and the showcase header.
- **MCP bridge cookie mode**: `useSessionMcpBridge` (mounted in `App`) connects `/api/mcp/ws` without a token while signed in; token and desktop bridges keep precedence. The bridge sends `{type:"focus"}` on tab focus/visible in both modes. On every (re)connect it first sends `{type:"hello",capabilities:["ack"]}`. A `tool_call` with `ack:true` is answered with `{type:"ack",id}` and HELD (not executed) until `{type:"go",id}` arrives; `{type:"cancel",id}` or 30 s without `go` drops it. A `tool_call` without `ack` executes immediately (old backends never set it), so never ack unprompted: an old backend rejects the call on an unknown `ack` reply.
- Test doubles: `src/test/authMocks.ts` (mock client/session, `stubAuthConfig`).

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
  **It publishes one object under two names** — `navigator.modelContext` and
  `document.modelContext` — because the proposal says `navigator` while the
  Chrome builds that expose the API at all put it on `document`, so an agent
  checks whichever its own reference named and concludes "unsupported" if it
  looks at the other. That is not hypothetical: it is exactly how an external
  agent reported this surface missing. The `document` write is best-effort —
  a failure there is logged and the install still succeeds, since the surface
  already exists and `getModelContext()` finds it — and the two names must
  stay the *same* object, or a caller that registers through one and executes
  through the other gets "Unknown tool".
- **21 tools**, a curated subset of the desktop bridge's
  (`DESKTOP_MCP_TOOL_NAMES`), of which eight write: `batch_design`,
  `set_variables`, `edit_embed_html`, `rename_layers`, the three comment writers
  and `attach_local_repo` (session state). The style readers
  (`get_styles`, `get_text_styles`) are read-only; the
  style writers and the component tools are on `/mcp` and the desktop bridge
  only, never here. Nothing consequential is exposed —
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
  those anyway) and embed source HTML is removed, since it is never
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
- **The context is installed from the entry bundle; the tools arrive later.**
  `installModelContextForEditorRoute()` runs in `main.tsx` (`earlyInstall.ts`),
  route-gated to `/app` and `/c/`, and never on the showcase. Registration
  still happens from `App.tsx`, which is a lazily imported chunk — measured on
  production, that chunk does not begin downloading until *after* the `load`
  event (entry 432-767ms, `load` 1312ms, editor chunk 1311-1656ms), and the
  effect runs later still. An agent that waits for `load` and looks once —
  the default behaviour of every browser-driving agent — used to find no
  model context at all and conclude the page does not support WebMCP. It now
  finds an empty `getTools()`, which means "not yet, ask again". Keep
  `earlyInstall.ts` cheap enough for the entry bundle: `polyfill.ts`'s only
  import is type-only, and nothing here may reach the tool registry or the
  stores.
  **Recipe for an agent author:** poll `getTools()` until it is non-empty
  (a second or two is normal on a cold load) rather than sampling once. There
  is no readiness event, in this implementation or in the native API.
- **The surface announces itself, because nothing else does.** WebMCP is
  passive: a page that publishes tools looks exactly like one that does not,
  so an agent finds them only by already knowing to look — which is the whole
  problem for the audience this surface exists for. Two signals close that,
  aimed at the two ways an agent meets the page.
  **Console** (`announce.ts`): one banner when the context is installed
  (`earlyInstall.ts`) saying the tools are still loading, and one when
  registration finishes, listing them plus a copy-pastable
  `executeTool("name", "{}")` call. Every line carries the literal `[webmcp] `
  prefix on its own — no `%c`, no `console.group`, both of which some
  harnesses fail to unwrap before regex-matching. The method name comes from
  `keyof ModelContextLike`, so renaming it breaks the typecheck instead of
  leaving the snippet quietly wrong. The registered banner is deduplicated on
  the registered+withheld set, since registration re-runs on every mount, and
  the whole body is guarded: `startWebMcp` calls it outside its own `try`, and
  `App.tsx` invokes that as `void startWebMcp()`, so an escaping throw would
  become an unhandled rejection.
  **Static** (`manifest.ts` + `vite/webmcpManifest.ts`): `/webmcp.json`, for
  an agent that only fetched the URL and got an empty SPA shell. It is built
  from `WEBMCP_TOOL_SPECS` and emitted by a Vite plugin rather than committed,
  so it cannot become a third copy of the contract that drifts — which is also
  why `manifest.ts` and everything it imports must stay free of the `@/` alias
  and of DOM globals (`vite.config.ts` is loaded by esbuild with neither), a
  rule `manifest.test.ts` enforces against the module *source*. `index.html`
  points at it with `<link rel="mcp-tools">` plus a `<meta name="webmcp">`;
  both name the editor routes rather than claiming tools exist on the current
  page, because that same HTML also serves the showcase at `/`. Routes in the
  manifest are written under the configured `base` (the Pages build is not at
  the origin root). This used to need two workbox carve-outs — keeping `json`
  out of the precache so the manifest could not go stale, and denylisting
  `/webmcp.json` from the navigation fallback so `page.goto` got the manifest
  rather than the precached SPA shell. Both are gone with the service worker
  (see "No service worker" below): nothing precaches, and the host's
  single-page-application fallback only applies to paths with no real file,
  which `/webmcp.json` is not.
- `webmcp.e2e.json` at the repo root is the expectation manifest — risk class,
  annotations and a safe fixture input per tool. Nothing executes it; it is
  what a person checks a running editor against.

### No service worker

This app deliberately ships none, and `public/sw.js` is a tombstone rather
than a worker: browsers that loaded a pre-removal build still have the old
workbox worker registered at that URL and keep polling it, so the file has to
keep existing to tell them to unregister, drop their caches and reload. It
skips `/app` clients on purpose — an editor document is in-memory only, so
force-reloading that tab would discard unsaved work; those tabs are
unregistered too and pick up the live bundle on the user's own next reload.
Do not add a `fetch` handler to it.

**Never delete `public/sw.js`, and do not treat that as a temporary state.**
The obvious assumption — that once the removal shipped, a missing `/sw.js`
would simply 404 and the browser would give up on the worker — is wrong, and
was measured rather than reasoned about. Serving `404 text/plain` (exactly
what this host returns for a deleted file — it does *not* fall back to the SPA
shell) leaves the registration, the precache and the stale page fully intact
after repeated navigations, in both chromium and webkit. A 404 is not an
unregister signal; it just fails the update check and keeps what is already
installed. So deleting this file does not retire the worker, it freezes every
client that still holds one, permanently.

There is also no way to know when the last such client has checked in. That
would need `/sw.js` request counts, and the Render static site emits only
build logs — no request logs at all. Nothing else ever fetches this file (the
app registers no worker), so its traffic is exactly the population still stuck
— which is precisely the number that cannot be observed here. With no
observable stopping condition and a 2 kB cost, the file is permanent.

To verify a change to it, drive a real browser: serve a page whose old worker
precaches a stale copy of itself, swap `/sw.js` to the candidate script, and
assert the client ends up unregistered, cacheless and on the live bundle
without a reload loop, while an open `/app` tab keeps its document. Vitest
cannot: it never executes a service worker.

Nothing may call `serviceWorker.register()` again. `src/__tests__/
serviceWorkerRemoval.test.ts` enforces both halves — the tombstone's contents
and the absence of any registration in `src/**` — because neither is visible
to any other test: the worker never runs under Vitest.

The web app manifest stays (`public/manifest.webmanifest`, base-relative URLs
so it works under any deploy base), so icons, theme colour and iOS
add-to-home-screen are unaffected. Chrome's install prompt needs a worker and
is the one capability given up.

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
- **In-turn rows** (`MessageList.tsx` -> `MemoryActivityRow`, which replaced
  `MemoryToolIndicator` / `SkillToolIndicator`). `memory` and `skill_manage`
  are backend-executed, so they arrive as ordinary tool parts. **Neither ever
  throws**: a refused write (over capacity, ambiguous match, circuit breaker, a
  guard rejection) comes back as normal output carrying `ok: false`. So a row is
  rendered *only* for a parsed, genuine success — anything else must fall
  through to `ToolCallIndicator`, which shows the output and therefore the
  error. Parse defensively; the output may be a JSON string, an object, or a
  shape nobody anticipated. The row is English ("Memory updated", brain icon),
  collapsed by default, with a chevron like `ToolCallIndicator`; expanded, it
  lists WHAT changed. In-turn details come from the tool INPUT
  (`memoryChangesFromInput`: `target` + `operations[{action, content, old_text}]`;
  for `skill_manage`: action, name, description, old_string, new_string,
  absorbed_into). All change shapes and their English line texts live in the
  pure `src/lib/memoryActivity.ts` (`ChangeDetail`, `formatChange`), shared with
  the background path. No details (older backend, or input we could not read)
  means no chevron, just the label.
- **`useAgentActivityNotes`** — the background review runs server-side *after*
  the stream closes, so the model cannot mention it. This schedules two delayed
  checks of `GET /api/memory/activity` per finished turn and records a note when
  a `background_review` event of subsystem `memory` **or** `skill` was written
  (FIR-71, which kept memory writes silent, is reversed: they are shown). Each
  event may carry `detail` (`{kind:"memory", target, operations[]}` or
  `{kind:"skill", action, name, ...}`); the note's `changes: ChangeDetail[]`
  is built from them (`changesFromEventDetail`); memory detail may carry
  `moreOperations` (operations beyond the backend's 10, cut), shown as a last
  line "…and N more changes" for that event. A skill patch with an empty
  `new_string` is a deletion ("removed <old>"), a new string alone is an
  addition. An event without `detail` still triggers the row but adds no line.
  A duplicate memory add (a backend no-op) is still listed. In-turn
  "Forgot/Updated" lines show the model's `old_text` match string, not the full
  stored entry. It reads by **event-id cursor**
  kept in `localStorage`, never a timestamp — the endpoint filters on Postgres
  `created_at`, so a browser clock a few minutes off would silently suppress or
  repeat every note. A baseline against a server with no rows records a zero
  cursor: "checked, saw nothing" has to be distinguishable from "never checked",
  or the very first review is swallowed. The note (`ChatActivityNote`:
  `{ id, changesByEvent?, afterMessageId | turnMessageId }`) is **UI-only**:
  it lives in `chatStore.activityNotes[chatId]`
  (in-memory, like the chats and their messages, so it does not survive a
  reload), is **never added to the AI SDK `messages`** (that would reach the
  backend and break the model's history and prompt caching), and `MessageList`
  renders it as the same `MemoryActivityRow` inside the anchored assistant
  message (nothing if that message was rolled back). `afterMessageId` is the
  last assistant message when the turn finished (read once, when the checks are
  scheduled) — not at detection time, or a message sent during the 20-60s wait
  would carry the row, possibly the user's own bubble.
  The note id is stable per turn/event and `addActivityNote` finds it across all
  chats. A repeat of a known id **merges** instead of being dropped: new changes
  are merged per EVENT: `changesByEvent` is keyed by `String(eventId)` (or
  `noid:<its own content>` for an event without a numeric id), the merge is a
  union by key and existing keys win. An event seen twice is listed once, but a
  later event with identical text (add X, remove X, add X) is its own entry. The
  row lists the values flattened (`noteChangeList`: numeric ids ascending, then
  id-less ones). So the 20s and 60s checks, and several mounted chats, give one row
  whose list is the union. Separate browser tabs have separate stores and can
  each show it. **Anchoring:** newer
  backends put `chatId` (the chat's id = `sessionId`) and `messageId` (the
  USER message that started the reviewed turn) on each event. Events
  are grouped per (chatId, messageId); one note `{ id, turnMessageId }` per
  group goes to *that* chat's list (whichever chat scheduled the check). Its id
  is the turn (`memory-activity-turn-["chatId","messageId"]`), so writes of one
  turn seen by the 20s and the 60s checks still give one row. A chatId this tab
  does not hold (closed, or open in another browser tab) is skipped: the shared
  cursor still advances, so that row is lost rather than shown in the wrong
  chat. `MessageList` renders it under the last
  assistant message between that user message and the next one (nothing if the
  message was rolled back or has no reply). So a late review stays under the
  turn it reviewed. Events without both fields (older backend) fall back to
  `{ id, afterMessageId }` in the scheduling chat, anchored at turn end as
  above; `ChatActivityNote` has exactly one of the two anchors.

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

The editor reads/writes `.pen` files: JSON documents (`version` + `children` tree). The node types are declared in `src/types/scene.ts`.

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
