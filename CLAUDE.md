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
- **Tool-name contract**: `src/lib/__tests__/toolContract.test.ts` pins the `toolHandlers` name list and, when the sibling `../pen-editor-backend` checkout exists, imports its `src/ai/tools.ts` to assert the sets stay in sync (skipped otherwise). In CI the `contract` job checks out the backend's **`main`** at run time and sets `CONTRACT_REQUIRE_BACKEND=1`, so it cannot self-skip. It asserts both directions — every `penTools` entry has a handler here, and `get_screenshot` is the only frontend-only handler — so a tool breaks the contract until both halves land, and this job is red for *every* push here while that gap is open. **Land a new tool's backend schema on backend `main` first, then merge the handler here**, back-to-back: that way this job passes on the first try. Handler-first fails your own push and needs a re-run after the backend lands.
- **E2E** (`e2e/`, Playwright, chromium only): stubs `/api/chat` and `/api/models` with `page.route` — no backend or LLM needed — and verifies message → streamed tool call → local execution (node lands in sceneStore and LayersPanel) → auto-continuation. `window.__sceneStore` is exposed in dev mode (`src/main.tsx`) for assertions. Keep e2e out of Vitest (`exclude` in `vitest.config.ts`) and out of `tsc -b` (own `e2e/tsconfig.json`).
- `get_screenshot` needs WebGL and cannot be unit-tested — e2e territory. PixiJS must never be initialized in unit tests.

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
(`createToolDispatcher({ send })`): a serial queue so two concurrent bridged
calls can never interleave scene mutations mid-call, and the
unknown-tool → `tool_error` branch. `executeToolCall` itself already never
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
both — two independent serial queues into the same `toolHandlers`, which
could interleave scene mutations. `main.tsx` resolves this by ordering, not
locking: it awaits `initDesktopMcpBridge()` settling before even importing
`mcpBridge.ts`, and `mcpBridge.ts`'s `startMcpBridgeIfConfigured()` checks
`desktopMcpBridge.ts`'s `isDesktopMcpBridgeActive()` and no-ops if the desktop
bridge already registered — the desktop bridge always wins.

Both bridges drive the same `src/store/mcpBridgeStore.ts`
(`off | connecting | connected`), shown as a coloured dot plus label in the
**File → Settings** submenu (`Toolbar.tsx`) — no UI change was needed to
support the desktop path. It is a plain `<div>`, not `DropdownMenuLabel`:
Base UI's label part throws unless wrapped in a `Menu.Group`, which crashes
the whole menu.

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
  checks of `GET /api/memory/activity` per finished turn and toasts if a
  `background_review` event appeared, naming the subsystem (memory, skills, or
  both). It reads by **event-id cursor** kept in `localStorage`, never a
  timestamp — the endpoint filters on Postgres `created_at`, so a browser clock
  a few minutes off would silently suppress or repeat every toast. A baseline
  against a server with no rows records a zero cursor: "checked, saw nothing"
  has to be distinguishable from "never checked", or the very first review is
  swallowed. The toast id is stable per event so parallel chat tabs collapse
  into one notification.

### File Format

The editor reads/writes `.pen` files. These are accessed exclusively through the Pencil MCP tools — never read `.pen` files directly with file I/O.

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
