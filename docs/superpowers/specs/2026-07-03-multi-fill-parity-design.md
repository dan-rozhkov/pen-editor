# Multi-fill Figma parity — closing the single-fill gaps

**Date:** 2026-07-03
**Status:** approved for implementation (autonomous /goal session)

## Context

The Figma-style paint stack (`fills: Paint[]`) is already implemented end-to-end:
types (`src/types/scene.ts`), Pixi renderers (`fillStrokeHelpers.applyFills`,
`imageFillHelpers.applyImagePaintStack`), the FillSection properties UI
(add/remove/reorder/toggle/blend-mode), AI tools, htmlToDesign, and — the hard
requirement of this feature — **Figma paste already preserves full paint
stacks** (`figmaToScene/base.ts:applyFillPaints`, covered by
`figmaPaste.test.ts`; 59 tests pass today).

What remains are concrete places where a paint stack is silently dropped or the
legacy single-fill assumption leaks. This spec closes those gaps.

## Goals

Everything a user pastes from Figma with multiple fills must survive not just
the paste, but the full lifecycle: render, edit, clone/instance, export, and AI
serialization.

## Non-goals (deferred)

- Gradient/image fills on **text** nodes (textRenderer is single-solid by design).
- Blend modes and image paints on **path** nodes (documented pathRenderer limitation).
- Multi-layer / gradient **strokes** (Figma paste approximates gradient strokes as solid).
- Touch-capable drag-and-drop in FillSection (native HTML5 DnD stays).

## Work items

### 1. `src/utils/publicPenExport.ts` — export the paint stack (biggest gap)
`PenFill` models a single fill; `exportFill()` reads only legacy
`fill`/`gradientFill`/`imageFill` and never `node.fills`. A node with a paint
stack exports with fills lost.

- Extend the public `.pen` shape with `fills?: PenPaint[]` (bottom-to-top),
  where `PenPaint` mirrors `Paint` (solid/gradient/image + `visible`,
  `opacity`, `blendMode`; omit internal `id`).
- `exportFill()`/`exportNodeBase()`: when `getFills(node)` yields ≥2 paints,
  emit the `fills` array; single paint keeps the existing single-fill shape for
  back-compat (mirrors `applyFillPaints` logic).
- Tests: multi-fill node exports full stack; single-fill node output unchanged.

### 2. `src/lib/designToHtml/svgGeneration.ts` — path/polygon HTML export
Reads only `node.fill`/`fillOpacity`; a path/polygon with a stack degrades.

- Use `getRenderableFills(node)`. Solid top-most paint → current behavior;
  gradient paint → `<defs>` gradient + `fill="url(#…)"`; ≥2 visible paints →
  stacked duplicate `<path>`/`<polygon>` elements bottom-to-top (SVG is
  single-paint-per-element), each with its own fill/opacity. Image paints out
  of scope for SVG output (skip with the solid fallback, matching pathRenderer).
- Tests alongside `designToHtml/__tests__/fillStack.test.ts`.

### 3. `src/utils/cloneNode.ts` — `cloneNodeWithNewId` ref branch drops `fills`
The reusable-frame→`RefNode` conversion copies `fill`/`stroke` field-by-field
but not `fills` (nor `effects`). Copy both. Regression test.

### 4. `src/lib/tools/serializeUtils.ts` — surface paint-level bindings
Only `rec.fillBinding` (legacy) is surfaced to the AI context; per-paint
`colorBinding` inside `fills[]` is invisible. Include bound colors from the
stack in the serialized state. Small test.

### 5. FillSection — per-fill opacity control
`Paint.opacity` exists in the model and renderers respect it (and Figma paste
imports it), but the UI control was dropped, so a pasted 50%-opacity fill
layer can't be edited. Re-add a percent `NumberInput` in the fill popover next
to the blend-mode select, writing `updateFillAt(i, { opacity })`. Test in
`FillSection.test.tsx`.

### 6. New-node default → paint stack
`PropertiesPanel.tsx` creates nodes with legacy `fill: "#ffffff"`. Switch node
creation defaults to `fills: [createSolidPaint("#ffffff")]` so new nodes start
on the canonical representation. Only if the change is contained (creation
defaults + affected tests); if it ripples widely, keep legacy default and note
it — `getFills()` fallback makes this cosmetic.

## Architecture notes

- All writes to `fills` must spread `clearLegacyFillProps()` (existing contract).
- Fill changes are repaint-only (no layout recompute) — keep it that way.
- `getFills()` is WeakMap-memoized on the Pixi hot path; readers must not
  mutate returned arrays.

## Testing / verification

- Unit tests per work item (Vitest, happy-dom).
- Full gates: `npm run lint`, `npm test`, `npm run build` in `pen-editor/`.
- Figma-paste preservation re-verified via `figmaPaste.test.ts` multi-fill
  cases (already green; must stay green).
