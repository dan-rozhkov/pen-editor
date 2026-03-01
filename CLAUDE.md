# CLAUDE.md — pen-editor

## Commands

```bash
npm run dev       # Start Vite dev server
npm run build     # tsc -b && vite build (type-check + production build)
npm run lint      # ESLint on all files
npm run preview   # Preview production build
```

No test runner is configured. End-to-end testing uses Puppeteer/Playwright in-browser.

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
├── lib/                       # Tool registry, HTML→design conversion, etc.
├── types/                     # TypeScript types/interfaces
├── utils/                     # Utility functions
└── assets/                    # Static assets
```
