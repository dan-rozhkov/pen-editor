# Agent Instructions for Pen Editor

## Build/Lint Commands

- `npm run dev` - Start development server
- `npm run build` - TypeScript check and production build
- `npm run lint` - Run ESLint on all files
- `npm run preview` - Preview production build

## Code Style Guidelines

### Imports
- Use ES modules (`type: "module"`)
- Use path alias `@/` for imports from `src/` (e.g., `@/components/Canvas`)
- Imports order: React, third-party libs, `@/` imports, relative imports

### Components
- Use **PascalCase** for component files (e.g., `Canvas.tsx`)
- Use functional components with hooks
- TypeScript: strict mode enabled, no unused locals/parameters

### Styling
- **Tailwind CSS v4** with Vite plugin
- Use `clsx()` for conditional classes
- Use theme colors from `index.css` (e.g., `bg-surface-panel`, `text-text-muted`)

### Naming Conventions
- Components: PascalCase (e.g., `Canvas.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useNodePlacement.ts`)
- Stores: camelCase with `Store` suffix (e.g., `layoutStore.ts`)
- Utils: camelCase (e.g., `colorUtils.ts`)

### Canvas Rendering

The editor supports two rendering backends, switchable via dropdown in the right sidebar:

- **Konva** (default) — React-based renderer using `react-konva`
  - Entry point: `src/components/Canvas.tsx`
  - Per-node renderers: `src/components/nodes/` (e.g., `FrameRenderer.tsx`, `TextRenderer.tsx`)
  - Uses React component tree with Konva `Stage` / `Layer`

- **PixiJS** (in development, future replacement) — Imperative renderer using PixiJS
  - Entry point: `src/pixi/PixiCanvas.tsx`
  - Rendering logic: `src/pixi/renderers.ts`
  - State sync: `src/pixi/pixiSync.ts` (subscribes to Zustand stores and updates PixiJS containers)
  - Viewport: `src/pixi/pixiViewport.ts`, Interaction: `src/pixi/pixiInteraction.ts`
  - Overlays: `src/pixi/SelectionOverlay.ts`, `src/pixi/OverlayRenderer.ts`

Both renderers share the same Zustand stores (scene, viewport, selection, etc.), so switching preserves all state. The mode is persisted in `localStorage` (`"use-pixi"` key). The switch happens via conditional rendering in `src/App.tsx`.

When implementing rendering features, ensure both renderers are updated (or at minimum the one being actively worked on is noted in the commit).

### State Management
- Use **Zustand** for global state (see `src/store/`)
- Prefer local state when possible

### Error Handling
- Always handle errors in async operations
- Use TypeScript strict null checks

### Workflow (from swe.md)
1. Read `.tasks/progress.txt` and `.tasks/sprint.json`
2. Pick one failing feature, implement it
3. Test end-to-end (Puppeteer/browser)
4. Commit when passing: `feat: [description] — implemented and tested`
5. Update sprint.json: `passes: true`
6. Update progress.txt

**Prohibited:** Deleting tests, marking passed without testing, doing multiple features, leaving broken code
