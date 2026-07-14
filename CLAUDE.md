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
- **Tool-name contract**: `src/lib/__tests__/toolContract.test.ts` pins the `toolHandlers` name list and, when the sibling `../pen-editor-backend` checkout exists, imports its `src/ai/tools.ts` to assert the sets stay in sync (skipped otherwise).
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
