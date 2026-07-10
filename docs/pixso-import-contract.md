# Pixso import contract (plugin → "Import from Pixso")

This document describes the JSON a Pixso plugin should produce so it can be
pasted into the editor via **File → Import → Import from Pixso**.

Flow: select a frame (or any node) in Pixso → the plugin reads it through the
Pixso plugin API → emits the JSON described here → the user pastes it into the
Import dialog. The dialog parses it with `parsePixsoNodes()`
(`src/utils/pixsoImportUtils.ts`), which converts each node into the editor's
scene graph and drops it onto the current page.

> This is **not** the editor's native `.pen`/document JSON (`version: "1.1"`,
> lowercase node types). That format is only used by **File → Open**. For the
> Import dialog, use the Pixso-shaped format below. See "Full-document
> alternative" at the end if you need Open instead.

## The good news: it's the Pixso/Figma plugin-API shape

The importer reads the **same field names and value conventions the Pixso
plugin API already gives you** (Pixso mirrors the Figma Plugin API). So in most
cases the plugin can walk the selected node tree and serialize the properties
almost verbatim. The importer is tolerant: unknown fields are ignored, and any
property it can't represent falls back gracefully (documented below).

Two things the plugin API does NOT hand you for free and you must resolve:

1. **`figma.mixed`** — a property that varies across a node (mixed fills, mixed
   font sizes, per-character styling) comes back as the `mixed` symbol. Resolve
   it to a single concrete value before emitting (the editor stores one value
   per node/property). If a text layer has genuinely mixed styling and must stay
   exact, split it into multiple text nodes or emit it as a `VECTOR`.
2. **Image bytes** — image paints reference an `imageHash`. Emit the actual
   bytes in a top-level `images` map (see "Image fills").

## Top-level shape

Any of these is accepted:

```jsonc
// (a) a single exported node
{ "id": "1:2", "type": "FRAME", ... }

// (b) wrapped, with an optional image map (recommended)
{ "data": { "id": "1:2", "type": "FRAME", ... },
  "images": { "<imageHash>": "data:image/png;base64,..." } }

// (c) a whole document/page — DOCUMENT/PAGE/CANVAS wrappers are unwrapped to
//     their descendant drawable nodes, each becoming a root on the page
{ "type": "PAGE", "children": [ { "type": "FRAME", ... }, ... ] }
```

Multiple roots are supported: the dialog imports every root it finds and selects
them all. `id`s are only used for logging; the importer generates fresh scene
ids, so they need not be stable (component instances are flattened — see below).

## Node object

Every node is a plain object. Only `type` is required; everything else has a
sensible default. Coordinates: `x`/`y` are relative to the parent; `width`/
`height` in px.

```ts
interface PixsoNode {
  id?: string;
  name?: string;
  type: string;          // see the type table below
  visible?: boolean;     // default true; false → imported hidden
  x?: number;            // default 0
  y?: number;            // default 0
  width?: number;        // default 100
  height?: number;       // default 100
  rotation?: number;     // DEGREES, counter-clockwise (Figma convention).
                         // The importer negates it to the editor's clockwise.
  opacity?: number;      // 0..1, node-level

  fills?: Paint[];       // bottom-to-top
  strokes?: Paint[];     // first visible SOLID is used
  strokeWeight?: number;
  strokeAlign?: "CENTER" | "INSIDE" | "OUTSIDE";
  individualStrokeWeights?: { top: number; right: number; bottom: number; left: number };
  // (or the flat variant) strokeTopWeight/strokeRightWeight/strokeBottomWeight/strokeLeftWeight

  cornerRadius?: number;
  cornerSmoothing?: number;   // 0..1 squircle amount
  topLeftRadius?: number; topRightRadius?: number;
  bottomLeftRadius?: number; bottomRightRadius?: number;

  effects?: Effect[];         // bottom-to-top

  children?: PixsoNode[];     // FRAME/COMPONENT/GROUP/... containers
  clipsContent?: boolean;     // frame clip
  layoutGrids?: LayoutGrid[];

  // auto-layout (on the container)
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingTop?: number; paddingRight?: number; paddingBottom?: number; paddingLeft?: number;
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "BASELINE";
  primaryAxisSizingMode?: "FIXED" | "AUTO";   // AUTO → hug on primary axis
  counterAxisSizingMode?: "FIXED" | "AUTO";   // AUTO → hug on counter axis
  layoutWrap?: "NO_WRAP" | "WRAP";
  minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number;

  // auto-layout (on a CHILD, relative to its parent)
  layoutPositioning?: "AUTO" | "ABSOLUTE"; // ABSOLUTE → excluded from flow
  layoutGrow?: number;   // >0 → fill parent's primary axis
  layoutAlign?: "INHERIT" | "STRETCH"; // STRETCH → fill parent's counter axis

  // text (TEXT nodes)
  characters?: string;
  fontSize?: number;
  fontName?: { family: string; style: string } | string; // style e.g. "Bold", "SemiBold Italic"
  fontWeight?: number;   // optional explicit numeric weight (overrides style-derived)
  fontFamily?: string;   // fallback if fontName absent
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  lineHeight?: { value: number; unit: "PIXELS" | "PERCENT" | "AUTO" } | number;
  letterSpacing?: { value: number; unit: "PIXELS" | "PERCENT" } | number;
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textAutoResize?: "WIDTH_AND_HEIGHT" | "HEIGHT" | "NONE" | "TRUNCATE";
  paragraphSpacing?: number;
  maxLines?: number;
  hyperlink?: { type: "URL"; value: string } | null;

  // ellipse arc (ELLIPSE nodes)
  arcData?: { startingAngle: number; endingAngle: number; innerRadius: number }; // angles in RADIANS, innerRadius 0..1

  // vector geometry (VECTOR / BOOLEAN_OPERATION nodes)
  fillGeometry?: { path: string; windingRule?: "NONZERO" | "EVENODD" }[];
  strokeGeometry?: { path: string; windingRule?: "NONZERO" | "EVENODD" }[];

  // star / polygon
  pointCount?: number;   // STAR: number of rays; POLYGON: number of sides
  innerRadius?: number;  // STAR only, 0..1 ratio of the outer radius
}
```

## Node type table

| Pixso `type` | Imported as | Notes |
|---|---|---|
| `FRAME`, `SECTION` | frame | |
| `COMPONENT`, `COMPONENT_SET` | frame (`reusable: true`) | variants not preserved as properties |
| `INSTANCE` | frame | **flattened** — emit the resolved child tree (see components) |
| `GROUP` | group | |
| `RECTANGLE` | rect | + corner radius / smoothing |
| `ELLIPSE` | ellipse | + `arcData` → arc/pie/donut |
| `LINE` | line | horizontal segment of the node's width |
| `TEXT` | text | one style per node (resolve `mixed`) |
| `STAR` | polygon (star) | `pointCount` rays, `innerRadius` ratio |
| `POLYGON`, `REGULAR_POLYGON` | polygon | `pointCount` sides |
| `VECTOR`, `BOOLEAN_OPERATION` | path (or group of paths) | from `fillGeometry` (preferred) or `strokeGeometry` |
| `DOCUMENT`, `PAGE`, `CANVAS` | (unwrapped) | children become roots |
| `SLICE` | (skipped) | no visual |
| anything else | frame if it has `children`, else rect | logged as a fallback |

## Colors

Colors are `{ r, g, b, a? }` with each channel a **0..1 float** (the plugin-API
convention), NOT 0..255 and NOT hex. `a` defaults to 1.

```jsonc
{ "r": 1, "g": 0.4, "b": 0, "a": 1 }   // opaque orange
```

## Fills

`fills` is an array, bottom-to-top. A paint with `visible: false` is skipped. The
importer keeps the whole stack; if it collapses to a single simple solid or
gradient it uses the editor's legacy single-fill fields, otherwise a full paint
stack — either way the result is faithful.

```ts
type Paint = SolidPaint | GradientPaint | ImagePaint;

interface PaintBase {
  visible?: boolean;   // default true
  opacity?: number;    // 0..1 layer opacity
  blendMode?: string;  // NORMAL, MULTIPLY, SCREEN, OVERLAY, DARKEN, LIGHTEN,
                       // COLOR_DODGE, COLOR_BURN, HARD_LIGHT, SOFT_LIGHT,
                       // DIFFERENCE, EXCLUSION (others → normal)
}

interface SolidPaint extends PaintBase {
  type: "SOLID";
  color: { r: number; g: number; b: number; a?: number };
}

interface GradientPaint extends PaintBase {
  // ANGULAR/DIAMOND are accepted but approximated as radial.
  type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND";
  gradientStops: { position: number; color: { r; g; b; a? } }[]; // position 0..1
  gradientTransform?: number[][]; // 2x3 affine [[a,c,e],[b,d,f]] (see note)
}

interface ImagePaint extends PaintBase {
  type: "IMAGE";
  imageHash: string;   // key into the top-level `images` map
  scaleMode?: "FILL" | "FIT" | "STRETCH" | "CROP" | "TILE";
}
```

Notes:
- **Gradient direction:** for linear/radial gradients, `gradientTransform` is
  read to recover the start/end handles. Axis-aligned gradients import exactly;
  arbitrarily rotated gradients are approximated. If direction matters and looks
  off, bake the gradient into an image.
- **Image fills:** put the bytes in the top-level `images` map, keyed by the
  same `imageHash`. Values may be a full `data:` URL, a raw base64 string
  (assumed PNG), or `{ url | data | bytes }`. `CROP` and `FILL` both import as
  aspect-preserving cover; `STRETCH` distorts each axis; `FIT` letterboxes;
  `TILE` is approximated as `FILL`. Image paints with no matching bytes are
  skipped.

```jsonc
{
  "data": { "type": "RECTANGLE", "width": 200, "height": 120,
            "fills": [ { "type": "IMAGE", "imageHash": "abc123", "scaleMode": "FILL" } ] },
  "images": { "abc123": "data:image/png;base64,iVBORw0KGgo..." }
}
```

## Strokes

Only a solid stroke color is imported (the first visible `SOLID` in `strokes`).
Width comes from `strokeWeight`, or from `individualStrokeWeights` (per side) —
the stroke color is kept even when only per-side widths are given. `strokeAlign`
maps to center/inside/outside. Gradient/dashed/variable-width strokes are not
represented — outline them into a `VECTOR` (`fillGeometry`) for exact fidelity.

## Effects

`effects` is bottom-to-top. Supported kinds:

```ts
type Effect =
  | { type: "DROP_SHADOW";  color: {r;g;b;a?}; offset: {x;y}; radius: number; spread?: number; visible?: boolean }
  | { type: "INNER_SHADOW"; color: {r;g;b;a?}; offset: {x;y}; radius: number; spread?: number; visible?: boolean }
  | { type: "LAYER_BLUR";       radius: number; visible?: boolean }
  | { type: "BACKGROUND_BLUR";  radius: number; visible?: boolean };
```

`radius` is the shadow/blur blur amount. Other effect kinds (e.g. `NOISE`) are
skipped. Background/backdrop blur is a native effect — do **not** rasterize it.

## Auto-layout

If `layoutMode` is `HORIZONTAL`/`VERTICAL`, it maps to the editor's flex model:

- `itemSpacing` → gap; `paddingTop/Right/Bottom/Left` → padding.
- `primaryAxisAlignItems` → justify (MIN/CENTER/MAX/SPACE_BETWEEN).
- `counterAxisAlignItems` → align (MIN/CENTER/MAX, STRETCH/BASELINE → stretch).
- `primaryAxisSizingMode: "AUTO"` / `counterAxisSizingMode: "AUTO"` → hug on that
  axis; `minWidth/maxWidth/minHeight/maxHeight` → sizing clamps.
- `layoutWrap: "WRAP"` → wrap.
- On a **child**: `layoutPositioning: "ABSOLUTE"` → absolute (out of flow);
  `layoutGrow > 0` → fill the parent's primary axis; `layoutAlign: "STRETCH"` →
  fill the counter axis.

If the frame is not auto-layout, omit `layoutMode` (or send `"NONE"`); children
keep their `x`/`y`.

## Text

One style per text node — resolve `figma.mixed` first. Field mapping:

- `fontName.style` → `fontWeight` (Thin…Black → 100…900) and italic; an explicit
  numeric `fontWeight` overrides the style-derived one.
- `textCase` → transform (`UPPER`→uppercase, `LOWER`→lowercase, `TITLE`→capitalize).
- `textAutoResize` → width mode (`WIDTH_AND_HEIGHT`→auto, `HEIGHT`→fixed width,
  `NONE`/`TRUNCATE`→fixed box).
- `lineHeight` `PIXELS` is converted to a multiple of `fontSize`; `PERCENT`/100;
  `AUTO` (or number) as given.
- `letterSpacing` `PIXELS` as-is; `PERCENT` resolved against `fontSize`.
- `textDecoration` → underline/strikethrough; `hyperlink.value` (URL type) →
  link; `paragraphSpacing`, `maxLines` pass through.
- Text color comes from the first solid `fills` entry.

## Ellipse arcs

```jsonc
{ "type": "ELLIPSE", "width": 100, "height": 100,
  "arcData": { "startingAngle": 0, "endingAngle": 4.71, "innerRadius": 0.5 } }
```

`startingAngle`/`endingAngle` are in **radians**; the importer converts to the
editor's `startAngle`/`sweepAngle` (degrees). `innerRadius` (0..1) makes a donut.

## Vectors

For arbitrary vectors, icons, boolean results, or anything you want pixel-exact,
emit a `VECTOR` (or `BOOLEAN_OPERATION`) with `fillGeometry` (preferred) or
`strokeGeometry`:

```jsonc
{ "type": "VECTOR", "x": 10, "y": 10, "width": 24, "height": 24,
  "fills": [ { "type": "SOLID", "color": { "r": 0, "g": 0, "b": 0 } } ],
  "fillGeometry": [ { "path": "M12 2 L2 22 L22 22 Z", "windingRule": "NONZERO" } ] }
```

One geometry → a single `path` node; multiple → a `group` of paths. Node-level
fills, gradients, effects, and opacity are carried onto the vector. `EVENODD`
winding is preserved for holes.

## Layout grids

```ts
interface LayoutGrid {
  pattern?: "COLUMNS" | "ROWS" | "GRID";
  visible?: boolean;
  color?: { r; g; b; a? };
  sectionSize?: number; // grid cell size
  count?: number;       // columns/rows
  gutterSize?: number;
  offset?: number;      // margin
  alignment?: "MIN" | "MAX" | "CENTER" | "STRETCH";
}
```

## Components

The importer does **not** reconstruct component/instance relationships (a pasted
frame has no library to bind to). For each `INSTANCE`, emit the **resolved**
child tree as a normal `FRAME` with its actual rendered content (apply overrides/
variant selections before export). Reusable-component authoring belongs to the
full-document path, not this dialog.

## What is approximated or dropped

- Component instances are flattened (no `ref`).
- Connectors, and any unknown leaf type, become a rectangle placeholder.
- Angular/diamond gradients → radial; rotated gradients approximate direction.
- Gradient/dashed/variable-width strokes → outline as a `VECTOR` for fidelity.
- Mixed per-character text styling collapses — split or vectorize.
- Masks, blend isolation, and pixel-dependent filters beyond the effects above
  → rasterize to an image paint.
- Image paints require bytes in the `images` map.

## Quick checklist

- Top level is a node, `{ data, images? }`, or a `DOCUMENT`/`PAGE` wrapper.
- Every node has a `type`; colors are 0..1 floats; rotation is CCW degrees.
- `figma.mixed` values are resolved to single concrete values.
- Image bytes are embedded in `images`, keyed by `imageHash`.
- Vectors carry `fillGeometry`; instances are pre-flattened.
- JSON parses (no comments/trailing commas); numbers are finite.

## Full-document alternative (File → Open)

If you'd rather import an entire multi-page document (with reusable components,
variables, and named styles) instead of pasting selected nodes, generate the
editor's **native** document JSON (`version: "1.1"`, lowercase node types,
loaded by `deserializeDocument()`) and open it via **File → Open**. That is a
different, higher-effort contract for the plugin and is out of scope here; ask
if you need it documented.
