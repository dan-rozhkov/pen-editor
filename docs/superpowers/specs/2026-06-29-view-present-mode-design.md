# Design: Figma-style View & Present modes

Date: 2026-06-29

## Goal

Add two Figma-like non-editing modes to the pen-editor:

1. **View (read-only) mode** — editor chrome stays, but all canvas editing is
   disabled. The user can pan/zoom, click to select a single node, and inspect
   its properties (read-only). Like Figma's viewer + inspect.
2. **Present (fullscreen) mode** — all editor chrome is hidden; the current
   top-level frame is fit to the window as a slide; arrow keys / click cycle
   through frames in canvas order. Like Figma's Present (▶).

Out of scope (deferred): following prototype `connection` links in Present mode.
Present uses plain frame cycling only.

## State — new `src/store/editorModeStore.ts`

```ts
type EditorMode = 'edit' | 'view' | 'present'

interface EditorModeState {
  mode: EditorMode
  presentFrameIds: string[]   // ordered top-level frame ids, captured on enterPresent
  presentIndex: number        // current slide index into presentFrameIds

  enterView(): void           // edit -> view
  enterPresent(): void        // -> present; captures ordered frames, sets index to
                              //   the frame containing current selection or 0
  exitToEdit(): void          // view|present -> edit
  nextFrame(): void           // present: clamp at last
  prevFrame(): void           // present: clamp at first
}
```

A new store keeps mode decoupled from `uiVisibilityStore`, which stays as the
plain `Cmd/Ctrl+\` panel toggle (orthogonal concern).

**Frame ordering for Present:** top-level `frame` nodes on the active page,
sorted by absolute `(y, x)` (top-to-bottom, then left-to-right). Computed from
`sceneStore` root frames + `layoutStore` rects. Captured once on `enterPresent`
so the slide list is stable during a presentation.

## Canvas gating — `src/pixi/interaction/`

A single guard reads `editorModeStore.mode`. The controllers that mutate the
scene are skipped unless `mode === 'edit'`.

| Capability                                                              | edit | view | present |
| ---------------------------------------------------------------------- | :--: | :--: | :-----: |
| Pan / zoom / touch / hover                                             |  ✅  |  ✅  |   ❌    |
| Click-to-select (single) + inspect in right panel                      |  ✅  |  ✅  |   ❌    |
| Drag-move, transform handles, marquee, draw, pencil, connector, delete |  ✅  |  ❌  |   ❌    |

- **view:** pointer-down still resolves a hit and selects a single node, but
  never starts a drag; transform handles are not rendered; marquee/draw/pencil/
  connector controllers early-return; delete/clipboard mutations are blocked.
- **present:** wheel-zoom and pan are locked (viewport is driven by the slide
  fit); no selection or hover.

Implementation approach: gate at the controllers' `pointerdown` entry (early
return when `mode !== 'edit'`), and gate selection-overlay handle rendering on
`mode === 'edit'`. Single-click selection path is allowed in `view`.

## Present rendering

- On `enterPresent` and on each `nextFrame`/`prevFrame`: fit the current frame's
  absolute bounds into the window with padding, and lock the viewport.
- Backdrop: neutral gray (Figma-like), distinct from the page background.
- On window `resize`: recompute the fit for the current frame.
- Navigation keys: `→` / `↓` / `Space` / click → `nextFrame`; `←` / `↑` →
  `prevFrame` (clamped, no wrap). `Esc` → `exitToEdit`.
- If the page has zero top-level frames, `enterPresent` is a no-op (toolbar
  button disabled in that case).

## UI

### New floating top-right toolbar — `src/components/ModeToolbar.tsx`

Absolutely positioned top-right, `pointer-events-auto`, rendered in `App.tsx`.

- **edit mode:** 👁 *View* toggle button + ▶ *Present* button. Present disabled
  when the active page has no frames.
- **view mode:** View toggle rendered active (click → `exitToEdit`) + Present
  button. Additionally:
  - `PrimitivesPanel` (draw tools) is hidden (drawing is disabled).
  - Right-panel inputs become read-only via a new `useReadOnly()` React context
    (`EditorModeProvider`) that shared input primitives respect (`disabled` /
    `readOnly`). Layers/Pages panels stay usable for navigation.
- **present mode:** all normal chrome is unmounted; only `PixiCanvas` + a minimal
  `PresentOverlay` is shown.

### `src/components/PresentOverlay.tsx`

Minimal fullscreen overlay shown only in present mode: frame counter (`2 / 5`),
‹ prev / › next buttons, ✕ exit. Auto-styled to stay out of the way.

## Shortcuts — `src/components/canvas/keyboardCommands.ts`

- `Shift+V` — toggle View mode (edit ↔ view).
- `Cmd/Ctrl+Enter` — start Present (no-op if no frames).
- `Esc` — exit view/present to edit. When `mode !== 'edit'`, this takes priority
  over the existing clear-selection behavior.
- In present: `→`/`↓`/`Space`/click next, `←`/`↑` prev.

All gated by `isTypingTarget(e)` like existing shortcuts.

## Testing

- **editorModeStore** unit tests: transitions (edit→view→edit, edit→present→edit),
  frame ordering by `(y, x)`, `next/prevFrame` clamping, `enterPresent` no-op
  with zero frames.
- **Gating** unit tests: in `view`/`present`, drag/draw/transform controllers do
  not mutate the scene; in `view`, single-click selection still updates
  `selectionStore`.
- **Component** tests: `ModeToolbar` renders correct buttons per mode and wires
  actions; `PresentOverlay` shows the counter and navigates.
- Existing suites must stay green (`npm test`, `npm run lint`, `npm run build`).

## Risks / open checks for the plan phase

- Read-only property panel depends on how many distinct input primitives the
  right panel uses. If they funnel through a few shared components, one
  `useReadOnly()` flag covers most; the plan phase will enumerate the input
  surface and decide whether to thread the flag or wrap the panel.
- Confirm exactly where single-click selection is initiated (likely
  `dragController` pointerdown) so view mode can keep select while dropping drag.
