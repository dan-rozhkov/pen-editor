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

## Optical balance

Equal boxes do not look equal. A circle, a triangle or a star fills less of
its box than a square, and a glyph with a tail or a knob looks bigger than
its main shape. Keylines (Material Design's keyline shapes) are the starting
point. The final check is optical: put the glyph in a row with Square and
Circle at the size it is used, then blur the row (about 2px at 20px) and
compare the blobs. Every blob must read as the same size and weight.

Rules of thumb, measured on this set (area of the ink's convex hull, in grid
units², 1.25px stroke):

- Closed objects (Square, Circle, File, Browser, Cube) sit at 120–146.
  Circle 141 and Square 146 are the reference pair.
- A triangle needs a bigger box than a square: Warning is 12.5 × 11.25,
  Play is 11.5 tall against Pause/Stop at 10.5.
- Play's triangle sits right of centre (`x 4.75 → 13.75`): its ink centre
  must land near x = 8, not its box.
- Concave shapes (Sparkle) and narrow ones (Lightbulb, Lock) grow until they
  reach the keyline in their long direction.
- A shape that adds mass outside its keyline (the chat bubble's tail) draws
  smaller to compensate.
- Diagonal tools (pencils, brush, wand) span corner to corner. Their hull is
  small by nature; do not enlarge them by that number.

To correct a glyph without redrawing it, pass `optics` as the fourth
`createIcon` argument: `{ scale, dx, dy }` scales about (8, 8), then moves
by `dx`/`dy` units. Strokes keep their width; dots and solid fills scale
with the glyph. Prefer real coordinates for a
new glyph; use `optics` for a correction to an existing one, with a comment
that says why. Never let the result cross the 1.25 → 14.75 safe zone.

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

## Against noise

An icon is judged at 16px next to text, not in a zoomed sheet. It is noisy
when it reads as a texture instead of a shape. Avoid:

- Small parallel lines packed together (hatching, keyboard keys, film
  sprocket holes, file text lines): use at most two, spaced ≥ 2.5 units.
- Small closed shapes under ~3 units across (they fill in to a blob).
- Grey (`fillOpacity`) fills: they read as dirt. Use solid `currentColor`
  for an emphasised region, or nothing.
- Badges crammed inside another glyph. A badge (+, ×, arrow) gets a clear
  zone: cut the base glyph around it with a ≥ 1.25 gap, or drop the base
  glyph's own details.
- Literal silhouettes (brain folds, octocat, tooth-by-tooth gears). Prefer
  the common UI metaphor, as Lucide / SF Symbols / Phosphor draw it.

Before redrawing an unclear glyph, look at how 3–4 established sets draw the
same idea (Lucide, Tabler, Phosphor, Heroicons, SF Symbols), take the
metaphor that reads best at small size, and redraw it on our grid. Never
paste their paths.

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
