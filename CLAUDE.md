# CLAUDE.md — pen-editor

## Commands

```bash
npm run dev       # Start Vite dev server
npm run build     # tsc -b && vite build (type-check + production build)
npm run lint      # ESLint on all files
npm run preview   # Preview production build
```

No test runner is configured. End-to-end testing uses Puppeteer in-browser.

## Path Alias

`@/` maps to `src/` (configured in both `tsconfig.app.json` and `vite.config.ts`).

```ts
import { useSceneStore } from "@/store/sceneStore";
```

## Architecture

### Dual Rendering Backends

The editor has two canvas renderers sharing identical Zustand state:

- **Konva** (default) — React-based via `react-konva`.
  Entry: `src/components/Canvas.tsx`, per-node renderers in `src/components/nodes/`.
- **PixiJS** (in development) — imperative renderer.
  Entry: `src/pixi/PixiCanvas.tsx`, rendering in `src/pixi/renderers.ts`, state sync in `src/pixi/pixiSync.ts`.

Switched via dropdown in the right sidebar; mode persisted in `localStorage` key `"use-pixi"`. Conditional rendering in `src/App.tsx`.

When implementing rendering features, update both backends (or note which is missing in the commit).

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

### Scene Graph & Layout

Nodes are stored as a flat map with parent-child references. The layout engine computes absolute positions/sizes from the tree. Node types include frames, text, rectangles, ellipses, paths, groups, etc.

### File Format

The editor reads/writes `.pen` files. These are accessed exclusively through the Pencil MCP tools — never read `.pen` files directly with file I/O.

## Code Style

### Naming

- Components: **PascalCase** (`Canvas.tsx`, `FrameRenderer.tsx`)
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
├── App.tsx              # Root — switches between Konva/PixiJS
├── main.tsx             # Entry point
├── index.css            # Tailwind + theme tokens
├── components/          # React components (UI + Konva renderers)
│   └── nodes/           # Per-node Konva renderers
├── pixi/                # PixiJS backend
│   ├── PixiCanvas.tsx   # PixiJS entry
│   ├── renderers.ts     # Node rendering logic
│   ├── pixiSync.ts      # Zustand → PixiJS sync
│   ├── pixiViewport.ts  # Viewport handling
│   └── pixiInteraction.ts
├── store/               # Zustand stores
├── hooks/               # Custom React hooks
├── types/               # TypeScript types/interfaces
├── utils/               # Utility functions
├── lib/                 # Shared library code
└── assets/              # Static assets
```
