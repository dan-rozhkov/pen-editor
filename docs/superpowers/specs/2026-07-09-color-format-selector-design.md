# HSL / color-format selector in the color picker

**Date:** 2026-07-09
**Scope:** `pen-editor` frontend only. One component: `src/components/ui/ColorPicker.tsx`.

## Problem

The color picker used for fill, stroke, effects, gradient stops, shaders, page background,
etc. (`CustomColorPicker`, rendered via `ColorInput`) exposes only a **single HEX text
field**. There is no way to read or type a color as RGB or HSL. Users want an HSL option in
a "color type" selector — which today does not exist at all.

## Goal

Add a compact **color-format selector** to the picker popover offering **HEX / RGB / HSL**,
so the user can view and edit the current color in any of those models. HSL is the headline
addition; RGB comes along for free and makes the selector meaningful.

## Non-goals (YAGNI)

- No HSB/HSV text mode (HSB stays the picker's internal color space for the area/hue slider only).
- No CSS-string / named-color mode.
- No changes to how colors are **stored**. Values remain hex strings; `onChange` keeps
  emitting `color.toString("hex")`. The selector affects only the *display/edit* representation.
- No changes to `colorUtils.ts`, renderers, or any other file. Because we never persist
  `hsl()`/`rgb()` strings, `applyOpacity` and friends need no HSL branch.

## Design

All changes are inside `CustomColorPicker` in `src/components/ui/ColorPicker.tsx`.

### State

```ts
type ColorFormat = "hex" | "rgb" | "hsl";
const [format, setFormat] = useState<ColorFormat>("hex");
```

Local component state, default `"hex"`. The choice persists while the popover is open and
across re-renders; it does not need to be stored on the node or globally.

### Selector UI — segmented control (NOT a dropdown)

Render a small 3-button segmented control (`HEX` · `RGB` · `HSL`) between the hue slider and
the input row. The active button is highlighted with existing theme tokens
(`bg-secondary` / `text-text-primary` for active, muted for inactive), matching the panel look.

**Why buttons, not a `<Select>`/dropdown:** the picker popover closes itself on any
`mousedown` landing outside `popoverRef` (see the click-outside `useEffect`). A react-aria
`Select`/dropdown renders its own listbox popover portaled to `document.body` — i.e. *outside*
`popoverRef` — so opening it would immediately close the color picker. Inline buttons live
inside the popover and sidestep this entirely.

### Input row per format (react-aria `ColorField` with `channel`)

react-aria's `Color` and `ColorField` already support these; the underlying `color` object is
shared, so alpha (from an 8-digit hex) round-trips across format switches untouched.

- **HEX** — unchanged: a single `<ColorField>` + `<Input>` (the current markup).
- **RGB** — three narrow `<ColorField colorSpace="rgb" channel="red|green|blue">` numeric
  inputs (0–255) in a row, each with a small label/aria-label.
- **HSL** — three narrow `<ColorField colorSpace="hsl" channel="hue|saturation|lightness">`
  numeric inputs (H 0–360, S/L 0–100) in a row.

The eyedropper button (when supported) stays at the end of the row for all three formats.
Reuse the existing `<Input>` className (shrunk to fit three-up) so styling stays consistent;
the 200px popover fits three inputs + eyedropper.

### Data flow (unchanged)

`AriaColorPicker value={color} onChange={handleChange}` still wraps everything;
`handleChange` still calls `onChange(c.toString("hex"))`. Channel edits mutate the shared
`Color`, which serializes back to hex. Nothing downstream sees a format change.

## Testing

- **Unit** (`src/components/ui/__tests__/ColorPicker.test.tsx`, new): render `CustomColorPicker`,
  open the popover, and assert:
  1. The segmented control shows HEX/RGB/HSL and HEX is active by default.
  2. Clicking RGB reveals three channel inputs populated from the current value
     (e.g. `#ff0000` → R 255, G 0, B 0).
  3. Clicking HSL reveals three channel inputs (e.g. `#ff0000` → H 0, S 100, L 50).
  4. Editing a channel calls `onChange` with a **hex** string (not `rgb()`/`hsl()`).
  5. Switching HEX(8-digit, e.g. `#ff000080`)→RGB→HSL→HEX preserves alpha.
  (Follow the happy-dom + real-store test conventions; no PixiJS.)
- **Lint / typecheck / build**: `npm run lint`, `npm run build` clean.
- **Manual/verify**: open the editor, select a shape, open a fill color picker, toggle
  HEX/RGB/HSL, confirm the swatch and canvas color stay correct.

## Risks

- Nested-popover close bug — mitigated by using inline buttons (above).
- Three-up input width in a 200px popover — verify visually; shrink padding if cramped.
- react-aria channel-field number formatting/locale — rely on defaults; assert on numeric value in tests.
