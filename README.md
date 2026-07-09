# Pen Editor

A canvas-based design editor with an AI design agent, built with React, TypeScript, and PixiJS. Think Figma-style vector editing plus a chat-driven agent that edits the scene graph for you.

## Tech Stack

- **React 19** — UI framework
- **TypeScript** — strict type safety
- **Vite** — build tool and dev server
- **PixiJS** — canvas rendering backend (single renderer; Konva has been removed)
- **Zustand** — state management
- **Tailwind CSS v4** — utility-first styling (via the Vite plugin)
- **Yoga** — auto-layout engine
- **Vercel AI SDK** — streaming chat with the design agent backend
- **Workbox** — PWA / offline support

## Features

### Drawing & shapes
- Frames, rectangles, ellipses, lines, polygons, **stars, arcs, and arrows**
- **Pen tool** — full Bézier path drawing and point editing
- Pencil (freehand), connectors, text, HTML embeds, notes, icon fonts, and images

### Layout & structure
- **Auto-layout** (Yoga): direction, gap, padding, alignment, **wrap**, and **min/max sizing**
- **Constraints** — fixed / scale / stretch for responsive frames
- **Components & variants** — reusable frames with instances, overrides, and property values (variant / boolean / text)
- Groups, masks, and **boolean operations** (union, subtract, intersect, exclude, flatten)
- **Tidy up** — auto-arrange a selection into an even row / column / grid

### Styling
- Fills: solid, **gradient**, **image**, and **pattern**; strokes with per-side control
- **Per-corner radius** and **corner smoothing** (squircle)
- Effects: **drop shadow**, **inner shadow**, and **layer blur**
- **Shaders** (paper-design) baked into the Pixi scene
- **Shared styles** (fill / effect) and **text styles**
- **Variables & themes** — design tokens with light/dark theme switching

### Images
- **Crop** and **adjustments/corrections** (brightness, contrast, etc.)
- AI **remove background** and AI **image generation**

### Precision
- **Rulers & guides**
- **Scale tool** (resize with proportional scaling of styles)
- Smart guides / snapping and pixel grid

### AI design agent
- Chat-driven editing of the scene graph (split-execution: tool schemas on the backend, execution in the browser)
- AI image generation and background removal
- Skills-based prompts (`/`-commands) and multiple agent modes (edits / prototype / research)

### Export & interop
- Export to **PNG**, **SVG**, and **PDF**
- **Copy as CSS** / **Copy as SVG** for a design→code handoff
- **Copy / paste properties** (style clipboard)
- Paste from **Figma** (fills, effects, text, components — imported as inline values)

### App
- **Present** and read-only **view** modes
- Pages
- **PWA** — installable, works offline

## Keyboard Shortcuts

Modifiers: **⌘/Ctrl** = Command on macOS / Control on Windows·Linux, **⌥/Alt** = Option / Alt.

### Tools
| Shortcut | Action |
|---|---|
| `V` | Select / move |
| `F` | Frame |
| `R` | Rectangle |
| `O` | Ellipse |
| `L` | Line |
| `G` | Polygon |
| `S` | Star |
| `P` | Pen (Bézier) |
| `D` | Pencil (freehand) |
| `T` | Text |
| `E` | Embed (HTML) |
| `C` | Connector |
| `K` | Scale |

### Edit
| Shortcut | Action |
|---|---|
| `⌘/Ctrl` + `Z` | Undo |
| `⌘/Ctrl` + `Shift` + `Z` | Redo |
| `⌘/Ctrl` + `C` / `X` / `V` | Copy / Cut / Paste |
| `⌘/Ctrl` + `A` | Select all (or all children inside an entered container) |
| `Delete` / `Backspace` | Delete selection |
| `Shift` + `⌥/Alt` + drag | Drop a duplicate at the drag position |

### Arrange & compose
| Shortcut | Action |
|---|---|
| `⌘/Ctrl` + `G` | Group |
| `⌘/Ctrl` + `Shift` + `G` | Ungroup |
| `Shift` + `A` | Wrap selection in an auto-layout frame |
| `⌘/Ctrl` + `⌥/Alt` + `U` / `S` / `I` / `X` | Boolean: Union / Subtract / Intersect / Exclude |
| `⌘/Ctrl` + `⌥/Alt` + `E` | Flatten |
| `⌘/Ctrl` + `⌥/Alt` + `T` | Tidy up |

### Copy styles & code
| Shortcut | Action |
|---|---|
| `⌘/Ctrl` + `⌥/Alt` + `C` | Copy properties (style) |
| `⌘/Ctrl` + `⌥/Alt` + `V` | Paste properties (style) |
| `⌘/Ctrl` + `Shift` + `C` | Copy as CSS |
| `⌘/Ctrl` + `Shift` + `S` | Copy as SVG |

> Copy as CSS / SVG are also available from the canvas **right-click context menu**.

### Selection & navigation
| Shortcut | Action |
|---|---|
| `Tab` / `Shift` + `Tab` | Select next / previous sibling |
| `Enter` | Edit text / enter path point-edit mode |
| `Shift` + `Enter` | Select parent frame |
| `Arrows` | Nudge 1px (or reorder within an auto-layout frame) |
| `Shift` + `Arrows` | Nudge 10px |
| `Space` + drag | Pan |
| `Esc` | Cancel drawing / exit edit / deselect |

### View
| Shortcut | Action |
|---|---|
| `⌘/Ctrl` + `0` | Fit to content |
| `⌘/Ctrl` + `\` | Toggle UI panels |
| `Shift` + `R` | Toggle rulers |
| `Shift` + `G` | Toggle layout grids |
| `⌘/Ctrl` + `Enter` | Enter present mode |

### Present mode
| Shortcut | Action |
|---|---|
| `→` / `↓` / `Space` | Next frame |
| `←` / `↑` | Previous frame |
| `Esc` | Exit present mode |

## Styling

This project uses **Tailwind CSS v4** with the Vite plugin. Theme tokens are defined in `src/index.css` and used as Tailwind classes:

- `bg-surface-panel`
- `text-text-muted`
- `border-border-default`
- `bg-accent-primary`

For conditional classes, use `clsx`:

```tsx
import clsx from 'clsx'

<div className={clsx('px-3 py-2', isSelected && 'bg-accent-primary')} />
```

## Development

```bash
npm install
npm run dev       # Vite dev server
npm run lint      # ESLint (0 errors expected)
npm test          # Vitest unit tests
npm run test:e2e  # Playwright smoke test (stubs /api/chat — no backend needed)
```

## Build

```bash
npm run build     # tsc -b && vite build
npm run preview   # preview the production build
```

## Design Agent Backend URL

Configure the backend URL at build time via Vite env variables:

- `VITE_AI_API_URL` — full chat endpoint URL (e.g. `https://api.example.com/api/chat`)
- `VITE_DESIGN_AGENT_BACKEND_URL` — backend base URL; the app calls `${BASE_URL}/api/chat`

Example:

```bash
VITE_DESIGN_AGENT_BACKEND_URL=https://api.example.com npm run build
```
