# Left Icon Rail — Design Spec

**Date:** 2026-06-26
**Status:** Approved (pending implementation plan)

## Summary

Add a Figma-style narrow vertical icon rail docked at the far left edge of the
editor. The rail lets the user switch the left sidebar's content between
**Pages**, **Agents**, and **Components**, and exposes a **Variables** action.
The chat ("Agents") UI, which today lives in a separate right/bottom panel, is
relocated into the left sidebar as the Agents section. The Layers tree is folded
into the Pages section.

## Goals

- A persistent, always-visible icon rail (~48px) at the far left, matching the
  Figma left-rail pattern.
- Rail items: Pages, Agents, Components, Variables.
- Move the full chat UI into the left sidebar under **Agents**; remove the
  standalone chat panel.
- Fold the active page's Layers tree into the **Pages** section.
- Single, fixed left-panel width (~300px) shared across all sections.

## Non-Goals

- No per-section or user-resizable panel width (explicitly one fixed width).
- No change to the right sidebar (Properties) or the bottom Primitives panel,
  except that the right-sidebar Variables button is left as-is.
- No change to the underlying stores for pages, chat, components, or variables —
  only their mount points / surfacing in the UI change.
- No redesign of the chat component internals (tabs, model picker, agent modes,
  parallel count, expand-over-canvas all preserved).

## Layout

```
┌────┬──────────────────┬────────────────────────────┬──────────────┐
│    │                  │                            │              │
│ R  │   Left Panel     │          Canvas            │  Right       │
│ a  │   (~300px,       │     (PixiJS, full bg)      │  Sidebar     │
│ i  │    content by    │                            │  (Properties)│
│ l  │    section)      │   ┌──────────────────┐     │              │
│    │                  │   │ Primitives panel │     │              │
│48px│                  │   └──────────────────┘     │              │
└────┴──────────────────┴────────────────────────────┴──────────────┘
```

- The rail is the leftmost flex region, always docked, always visible.
- The left panel sits immediately to the rail's right and keeps its existing
  float/dock behavior (the rail itself never floats).
- The standalone `ChatPanel` mount (previously floating on the right / bottom)
  is removed from `App.tsx`; the chat now renders inside the left panel's
  Agents section.

## Rail Items

| Item       | Icon (Phosphor)       | Behavior                                                                 |
|------------|-----------------------|-------------------------------------------------------------------------|
| Pages      | `Notebook` / `Files`  | Swaps left panel to the Pages section (pages list + active page layers). |
| Agents     | sparkle / chat icon   | Swaps left panel to the full chat UI.                                    |
| Components | `DiamondsFour`        | Swaps left panel to the components grid.                                 |
| Variables  | `SlidersHorizontal`   | Action only — opens the existing Variables modal. Does NOT swap panel.   |

- The active section's icon is highlighted with the accent treatment
  (`bg-accent`-style highlight, matching the screenshot's selected state).
- Variables is an action, not a section: clicking it opens the modal and leaves
  the current section selection unchanged.

## Sections

### Pages
Renders the existing pages list **and** the layer tree of the active page in one
section (Pages on top, Layers below). This replaces the current
Layers | Components tab bar inside `LeftSidebar`. Reuses `PagesPanel` and
`LayersPanel` as-is.

### Agents
Hosts the full chat UI relocated from the current right/bottom `ChatPanel`:
chat tabs, model picker, agent modes (edits/prototype/research), parallel count,
message history, and input. The **expand-to-full-width over the canvas** feature
is preserved. The `ChatPanel` component is reused largely unchanged; only its
mount point moves.

### Components
Renders the existing `ComponentsPanel` (components grid) unchanged.

### Variables
No section panel. The rail icon opens the existing Variables modal dialog. The
right-sidebar Variables button remains a second entry point to the same modal.

## State

Add a UI state field for the active left section:

```ts
activeLeftSection: 'pages' | 'agents' | 'components'
setActiveLeftSection(section): void
```

- Default: `'pages'`.
- Variables is intentionally NOT a value of `activeLeftSection` — it is an action
  that opens a modal.
- Placement: extend an existing UI/layout store (e.g. alongside
  `floatingPanelsStore`) or a small dedicated store; the implementation plan will
  pick the exact home, following existing store conventions. Persist to
  localStorage to match the floating-panel persistence pattern.

## Components Touched

- **New:** `LeftRail.tsx` — the icon strip. Renders the four rail buttons,
  reads/sets `activeLeftSection`, and triggers the Variables modal.
- **New:** store field `activeLeftSection` (+ setter) in the chosen UI store.
- **`App.tsx`** — add `LeftRail` as the leftmost flex region; remove the
  standalone `ChatPanel` mount.
- **`LeftSidebar.tsx`** — render content by `activeLeftSection` instead of the
  Layers/Components tab bar; the Pages section combines pages + layers.
- **`ChatPanel.tsx`** — reused inside the Agents section; mount point moves,
  internals (including expand-over-canvas) preserved.

## Styling

- Rail: ~48px wide, `bg-surface-panel`, `border-r border-border-default`,
  full height.
- Rail buttons: icon-only, `p-1.5`, `text-text-muted`, hover
  `hover:bg-surface-hover hover:text-text-primary`; active state uses the accent
  highlight (light accent background + accent icon color), matching the Figma
  screenshot.
- Icons from `@phosphor-icons/react` (already a dependency).
- Left panel keeps `bg-surface-panel` and the existing float/dock styling.

## Floating Mode

- The rail is always docked at the far left and never participates in floating.
- The left content panel retains its current float/dock toggle behavior.

## Testing

- Unit: rail renders four items; clicking Pages/Agents/Components updates
  `activeLeftSection` and swaps rendered content; clicking Variables opens the
  modal without changing `activeLeftSection`.
- Unit: default section is `'pages'`; persistence round-trips through
  localStorage.
- Existing chat / layers / components / variables behavior is unchanged
  (existing tests for those panels should continue to pass with updated mount
  points).
- E2E smoke test remains green: message → streamed tool call → local execution,
  with the chat now reached via the Agents rail section.
