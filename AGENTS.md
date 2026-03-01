# Agent Instructions for Pen Editor

## Build/Lint Commands

- `npm run dev` - Start development server
- `npm run build` - TypeScript check and production build
- `npm run lint` - Run ESLint on all files
- `npm run preview` - Preview production build

## Code Style Guidelines

### Imports
- Use ES modules (`type: "module"`)
- Use path alias `@/` for imports from `src/` (e.g., `@/store/sceneStore`)
- Imports order: React, third-party libs, `@/` imports, relative imports

### Components
- Use **PascalCase** for component files (e.g., `PixiCanvas.tsx`)
- Use functional components with hooks
- TypeScript: strict mode enabled, no unused locals/parameters

### Styling
- **Tailwind CSS v4** with Vite plugin
- Use `clsx()` for conditional classes
- Use theme colors from `index.css` (e.g., `bg-surface-panel`, `text-text-muted`)

### Naming Conventions
- Components: PascalCase (e.g., `LayersPanel.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useNodePlacement.ts`)
- Stores: camelCase with `Store` suffix (e.g., `layoutStore.ts`)
- Utils: camelCase (e.g., `colorUtils.ts`)

### Canvas Rendering

The editor uses **PixiJS** as the sole rendering backend (Konva has been removed).

- Entry point: `src/pixi/PixiCanvas.tsx`
- Per-node renderers: `src/pixi/renderers/` (e.g., `frameRenderer.ts`, `textRenderer.ts`)
- State sync: `src/pixi/pixiSync.ts` (subscribes to Zustand stores, updates PixiJS containers)
- Viewport: `src/pixi/pixiViewport.ts`
- Interaction: `src/pixi/interaction/` (`dragController.ts`, `drawController.ts`, `transformController.ts`, etc.)
- Overlays: `src/pixi/SelectionOverlay.ts`, `src/pixi/OverlayRenderer.ts`

### State Management
- Use **Zustand** for global state (see `src/store/`)
- Prefer local state when possible
- `sceneStore` is split into modules under `src/store/sceneStore/`

### Error Handling
- Always handle errors in async operations
- Use TypeScript strict null checks

### Workflow (from swe.md)
1. Read `.tasks/progress.txt` and `.tasks/sprint.json`
2. Pick one failing feature, implement it
3. Test end-to-end (Puppeteer/Playwright)
4. Commit when passing: `feat: [description] — implemented and tested`
5. Update sprint.json: `passes: true`
6. Update progress.txt

**Prohibited:** Deleting tests, marking passed without testing, doing multiple features, leaving broken code
