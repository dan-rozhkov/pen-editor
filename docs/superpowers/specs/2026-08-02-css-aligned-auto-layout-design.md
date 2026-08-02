# CSS-aligned auto layout (Figma "updated auto layout" parity)

**Date:** 2026-08-02
**Status:** approved
**Scope:** `pen-editor` only (layout engine + resize interaction + tests). No backend changes.

## Background

Figma's July 2026 "updated auto layout" closes six behavioral gaps between auto layout
and CSS flexbox. An audit of our layout engine (`src/utils/yogaLayout.ts`,
`src/store/layoutStore.ts`) against those six behaviors found:

| # | Figma updated behavior | pen-editor today |
|---|---|---|
| 1 | Padding always gets the room it needs (frame min size ≥ padding sum, border-box) | Hug/fit-content: already enforced (`computeIntrinsicSize`). Fixed-size frames: **not enforced** — `contentSpace` can go negative (`positionMainAxis`), children start past the frame edge |
| 2 | Inside strokes count in layout like CSS `border`; center/outside strokes act like `outline` | **Strokes never participate in layout** — engine reads no stroke fields; everything behaves like `outline` |
| 3 | Parent's stroke setting no longer affects children | Trivially satisfied — we have no such flag and will not add one |
| 4 | Fill-container children distribute by content area (thicker inside strokes ⇒ proportionally more outer size, equal inner content) | Real flex-grow/shrink algorithm exists, but strokes are invisible to it |
| 5 | Auto gap (space-between) floors at 0 — children never overlap each other | **Already matches** (`freeSpace = Math.max(0, …)`) — needs a regression test |
| 6 | Single child in an auto-gap stack aligns to start, not center | **Already matches** (`gapCount = 0` ⇒ offset 0) — needs a regression test |

Decision (approved): **global engine change, no legacy/`layoutVersion` mode.** Existing
`.pen` documents reflow under the new rules on open. This is acceptable for a
personal tool, and the blast radius is small because the default `strokeAlign` is
`'center'` (renderers: `strokeAlign ?? 'center'`), which stays layout-inert — only
frames explicitly set to `inside` strokes change at all.

## Design

### A. Padding (+ inside-stroke) floor for fixed-size frames

An auto-layout frame's effective size during layout is clamped:

```
effectiveMainSize  = max(frame.mainSize,  padMainStart + padMainEnd)
effectiveCrossSize = max(frame.crossSize, padCrossStart + padCrossEnd)
```

where `pad*` is the *edge inset* defined in section B (padding + inside stroke).
Applied in `buildContainer` (`yogaLayout.ts`) so `contentSpace` can never go
negative anywhere downstream. The stored `frame.width/height` is NOT mutated —
only the layout computation clamps (mirrors CSS border-box: an element is never
rendered smaller than its padding+border box).

Interactive resize of an auto-layout frame (Pixi interaction layer,
`src/pixi/interaction/`) clamps its minimum to the same edge-inset sum, so the
handle stops where the layout floor is — no dead zone where dragging does nothing.
Non-auto-layout frames are untouched.

### B. Inside strokes participate in layout as CSS `border`

Definition — **edge inset** per side of a frame:

```
inset(side) = padding(side) + insideStroke(side)
insideStroke(side) = strokeAlign === 'inside' ? (strokeWidthPerSide?.[side] ?? strokeWidth ?? 0) : 0
```

`center` and `outside` strokes contribute 0 (CSS `outline` semantics). A stroke
only counts if the node actually has a visible stroke (same predicate the
renderer uses for drawing strokes — reuse it, do not re-derive).

Three touch points in the engine:

1. **Container content space.** `resolvePadding` returns edge insets instead of
   raw padding. Children are laid out inside `size − insets` on both axes. This
   automatically fixes intrinsic (hug) sizing too: `computeIntrinsicSize` adds
   insets, so a hug frame grows to fit content + padding + inside stroke.
2. **Fill-container distribution by content area.** In `resolveMainAxisSizes`,
   a `fill_container` child's inside-stroke sum on the main axis is treated as
   its border: it is subtracted from distributable space up front, the flexible
   pass distributes *content* space, and the child's final outer size is
   `contentShare + ownInsideStrokeSum`. Result: siblings with thicker inside
   strokes get proportionally more outer size and equal inner content areas —
   exactly CSS border-box distribution. Fixed/hug children are unchanged (their
   stored size is already the outer, border-box size). Min/max clamps keep
   applying to the outer size.
3. **Layout invalidation.** Mutating `strokeWidth`, `strokeAlign`,
   `strokeWidthPerSide`, or adding/removing a stroke paint on an auto-layout
   frame or a direct child of one must now trigger layout recompute (today it
   only repaints). Wire through the existing dirty-id channel
   (`src/store/sceneStore/dirtyTracking.ts`) the same way padding mutations do.

### C. Regression tests for already-correct behaviors

Unit tests (Vitest, `src/utils/__tests__/` or the existing yogaLayout test home)
pinning behaviors 5 and 6: overflowing space-between produces zero inter-child
overlap and flex-start collapse; a single space-between child sits at the start.

## Non-goals

- No `layoutVersion` / legacy mode, no document migration.
- No text `min-width: auto` (longest-word floor) — explicitly deferred.
- No `alignSelf` / `alignContent` / numeric flex-grow — separate track if ever.
- No backend/agent-tool changes: the tool surface exposes padding/stroke fields
  already; behavior change is engine-internal.

## Testing

- Unit tests per behavior: padding floor (fixed frame smaller than padding;
  resize clamp math), inside-stroke insets (hug growth, child positioning,
  fill distribution with mixed stroke widths, center/outside inertness),
  invalidation (stroke mutation reflows children), plus the section C pins.
- Existing yogaLayout/layoutStore suites must stay green; any snapshot that
  encoded the old (stroke-blind) numbers gets updated deliberately, not blindly.
- Manual smoke: open an existing document with inside-stroked auto-layout
  frames and confirm the reflow looks sane before release.

## Risks

- Silent reflow of old documents: bounded by the `center` default; only
  explicit inside strokes move. Accepted.
- Perf: edge-inset computation adds a per-frame field read in hot layout code —
  keep it allocation-free; `?perf=N` harness budgets must not regress.
