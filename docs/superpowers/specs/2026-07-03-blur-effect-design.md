# Layer Blur effect — design

Date: 2026-07-03. Status: approved (autonomous goal session).

## Goal

A "Layer Blur" effect on any node, managed in the existing **Effects** section of the properties panel, rendered live in PixiJS, round-tripped through HTML conversion and public .pen export.

## Scope decisions

- **Layer blur only** (Figma-style: blurs the node's own rendering). Background/backdrop blur is out of scope — different Pixi mechanism; the type is designed so it can be added later as a separate union member.
- **AI tool exposure (batch_design) is out of scope** — effects (including shadows) are not currently settable via the AI tool layer at all; adding them is a separate backend-synced feature.
- At most **one blur is applied** at render time: the first visible blur in the stack wins (the UI does not prevent adding several; the renderer just uses the first visible one).

## Data model

`src/types/scene.ts`:

```ts
export interface BlurEffect {
  type: "blur";
  radius: number;      // px, 0–100, default 4
  id?: string;
  visible?: boolean;   // default true (same convention as ShadowEffect)
}

export type Effect = ShadowEffect | BlurEffect;
```

`src/utils/fillUtils.ts`: add `createBlurEffect(): BlurEffect` (radius 4, fresh id, visible true), next to `createShadowEffect()`.

Existing helpers (`getEffects`, `getRenderableEffects`, stack helpers in `fillSectionUtils.ts`) are already type-agnostic and need no changes.

## Inspector UI — `EffectsSection.tsx`

- The "Add effect" plus button becomes a small menu (existing popover/dropdown primitives) with two items: **Drop shadow** → `createShadowEffect()`, **Layer blur** → `createBlurEffect()`.
- `effectLabel()` returns "Layer blur" for `type === "blur"`.
- Row rendering branches on `effect.type`:
  - shadow → existing editor unchanged;
  - blur → popover with one `NumberInput` (label "Blur", min 0, max 100, step 1) writing `radius` via `updateEffectAt` + `commit`, plus the existing reorder/visibility/delete controls which already work generically.
- Row swatch for blur: reuse the swatch slot with a blur glyph or neutral chip (no color — blur has none).
- Multi-select path (`MultiSelectPropertyEditor`) already routes through `EffectsSection` and needs no changes.

## Rendering — PixiJS

`src/pixi/renderers/blurHelpers.ts` (new, sibling of `shadowHelpers.ts`):

```ts
applyLayerBlur(container: Container, effects: Effect[]): void
```

- Finds the first visible `type === "blur"` effect. If present and `radius > 0`: sets `container.filters = [new BlurFilter({ strength: radius / 2, quality: 3 })]` (same strength convention as shadow blur in `shadowHelpers.ts:79`). Otherwise clears blur filters from the container.
- Must not clobber non-blur filters if any appear later — filter list is rebuilt as: existing non-BlurFilter entries + our blur. (Today the node container never has other filters; shadow blur lives on a child container, so no conflict.)
- Called from `renderers/index.ts` wherever `applyShadows` is called (create ~line 399 and each update path), passing `getRenderableEffects(node)`.

Not unit-testable (WebGL); the helper's decision logic (`pickLayerBlur(effects)` — a pure function returning the effective radius or null) is extracted and unit-tested.

## Serialization / conversion

- `src/lib/designToHtml/styleGeneration.ts`: a visible blur effect emits `filter: blur(<radius>px)` on the element (first visible blur only, matching the renderer).
- `src/lib/htmlToDesign/styleApplication.ts`: parse CSS `filter: blur(Npx)` → append a `BlurEffect` to the node's `effects`.
- `src/utils/publicPenExport.ts`: `exportEffects()` currently only reads the legacy single `node.effect` shadow. Extend it to read the `effects` stack via `getEffects(node)` and emit both shadow and blur entries (`{ type: "blur", radius, visible? }`); widen the exported effect typing accordingly. Fixing the stack omission is in scope because blur only exists in the stack.

## Testing

- `EffectsSection.test.tsx`: add cases — add blur via the menu, edit radius, toggle visibility, delete; mirror the existing mocking approach.
- `fillUtils.test.ts`: `createBlurEffect` defaults.
- New pure-helper test for `pickLayerBlur`.
- `designToHtml` tests (mirror `fillStack.test.ts`): blur → `filter: blur()`; combined shadow + blur.
- `htmlToDesign` test: `filter: blur(6px)` round-trips to a `BlurEffect`.
- `publicPenExport` test: effects stack with shadow + blur exports both.
- E2E: not needed — the existing smoke test doesn't cover effects; rendering is verified manually.

## Error handling / edge cases

- `radius` clamped to 0–100 in the UI; renderer treats `radius <= 0` as no filter.
- Invisible (`visible: false`) blur → no filter, no CSS.
- Legacy `effect` field: untouched; `commit()` already clears it when the stack is written.
