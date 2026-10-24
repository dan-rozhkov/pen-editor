# Pen icon style

The editor's own icon set, after Cursor's icon system (Minor Adventures, "The
Making of Cursor's Icons"). One look everywhere: thin, technical, closed
shapes, round ends. Read this before drawing or changing a glyph.

## Canvas

- `viewBox="0 0 16 16"`. Coordinates are in that grid; decimals are fine
  (strokes are not snapped to pixels).
- The stroke is set by `createIcon`, never per path: 1.25px on screen
  (`vector-effect: non-scaling-stroke`), 1.5px for `weight="bold"` and for
  numeric `size >= 22`, 1px for `thin`. Do not put `strokeWidth` on shapes.
- Round caps, round joins — inherited from the `<svg>`. Do not override.
- Outline glyphs are strokes only (`fill="none"` inherited). A dot is a small
  filled circle: `<circle cx cy r="1" fill="currentColor" stroke="none" />`
  (r 0.9–1.1; "more" dots r 1).

## Keylines (where the outer edge of a shape sits, stroke centre)

| Shape      | Box (stroke centre)              | Example                 |
|------------|----------------------------------|-------------------------|
| Square     | 2.5 → 13.5 (11 × 11)             | Table, Image, File-ish  |
| Circle     | centre 8,8, r 6 (2 → 14)         | Info, CheckCircle, Globe|
| Horizontal | x 2 → 14, y 3.5 → 12.5           | Browser, Laptop, Link   |
| Vertical   | x 3.5 → 12.5, y 2 → 14           | File, DeviceMobile      |
| Lines      | 2.75 → 13.25                     | Plus, arrows, text rules|

A circle sits slightly larger than a square so both read as the same size.
Nothing goes outside 1.25 → 14.75 (the stroke would be clipped).

## Construction

- Start from horizontal, vertical and 45° lines. Other angles only where the
  idea needs them. Free-form curves are rare: build curves from circles/arcs.
- Corner radius: 1.5–2 for containers (rect `rx`), 0.75–1 for small parts.
  Not sharp, not pill-soft.
- Prefer closed shapes over open ones.
- Extend lines as far as they can go (monospace-type feel).
- Keep natural proportions: a phone is tall, a laptop is wide.
- Gaps between separate shapes: at least 1.75 units edge to edge (≈ 3 grid
  units at 16px stroke centre distance ≥ 3). Below that they merge at 12px.
- Diagonal things (arrows, rockets, stacked objects) point bottom-left →
  top-right; the smaller object sits top-right.
- Slashes (EyeSlash, CloudSlash, WifiSlash) run top-left → bottom-right,
  `M2.5 2.5l11 11`, and cut flat through the glyph: remove the glyph's
  strokes under the slash with a gap ≥ 1.25 on each side (use a mask keyed by
  `uid` or split the paths).
- Recurring elements are drawn the same way every time: file corner fold,
  arrow head (two 45° strokes of length ~3.5), caret (`M4 6l4 4 4-4`),
  magnifier lens, badge "+" etc. Copy them from existing glyphs.
- Detail budget: at 16px, no more than ~5 strokes. Drop decoration.

## Fill variant (`weight="fill"`)

Only where the app uses `weight="fill"`. A solid silhouette of the outline
glyph (the outer edge grown by half the stroke, ~0.6) with interior details
cut out — `fillRule="evenodd"` holes or a `<mask id={`m${uid}`}>`. The `<svg>`
paints fill = colour, stroke = none for this variant.

## API

```tsx
export const TableIcon = createIcon(
  "Table",
  <>
    <rect x="2.5" y="3" width="11" height="10" rx="1.75" />
    <path d="M2.5 6.5h11M6.5 6.5V13M2.5 9.75h11" />
  </>,
);
```

`createIcon(name, outline, fill?)`; `outline`/`fill` may also be
`(uid) => JSX` when a mask needs a unique id. Export name is `<Name>Icon`.
