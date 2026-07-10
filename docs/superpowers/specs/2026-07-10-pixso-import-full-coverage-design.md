# Pixso JSON import — full node-type & property coverage

**Date:** 2026-07-10
**Status:** Approved (autonomous goal-driven)
**Area:** `pen-editor/src/utils/pixsoImportUtils.ts`, `pen-editor/src/components/Toolbar.tsx`

## Goal

Make "Import from Pixso" cover **all** Pixso/Figma-plugin-API node types and the full
set of properties our scene graph can represent, with graceful, documented
fallbacks for the handful of source features we cannot represent. Today the
importer handles a useful subset (frame/group/rect/ellipse/text/vector/line/
polygon/star) and drops many properties (opacity, effects, the full fill stack,
image fills, ellipse arcs, corner smoothing, clip, layout wrap/min-max/absolute,
text case/link/paragraph attrs, etc.). It also imports only a single root node.

## Source format

Pixso exports use Figma Plugin API field names (the file references
`exportTypes_upd.ts`). Fields are the documented Figma `SceneNode` props:
`type`, `x/y/width/height`, `rotation`, `opacity`, `visible`, `fills[]`,
`strokes[]`, `strokeWeight`, `strokeAlign`, `individualStrokeWeights`,
`cornerRadius` + per-corner, `cornerSmoothing`, `effects[]`, `arcData`,
`layoutMode` + auto-layout props, `clipsContent`, `layoutGrids`, text props, etc.
The top-level payload may be a bare node, an `{ data: node }` wrapper, or a
`DOCUMENT`/`PAGE` container whose `children` are the real roots.

## Scope: node types

| Pixso `type` | Maps to | Notes |
|---|---|---|
| `FRAME` `COMPONENT` `COMPONENT_SET` `SECTION` | `frame` | COMPONENT → `reusable:true` |
| `INSTANCE` | `frame` | **flattened** (no matching componentId in a partial import) |
| `GROUP` | `group` | |
| `RECTANGLE` | `rect` | |
| `ELLIPSE` | `ellipse` | + `arcData` → startAngle/sweepAngle/innerRadiusRatio |
| `LINE` | `line` | |
| `TEXT` | `text` | full text props |
| `STAR` | `polygon` (star) | pointCount/innerRadius |
| `REGULAR_POLYGON` `POLYGON` | `polygon` | |
| `VECTOR` `BOOLEAN_OPERATION` | `path` (or group of paths) | from fill/stroke geometry |
| `DOCUMENT` `PAGE` `CANVAS` | (unwrapped) | recurse into children, no node emitted |
| `SLICE` | (skipped) | export-only guide, no visual |
| `CONNECTOR` | `line` fallback | our connector needs live node refs, absent on import |
| unknown / FigJam-only | best-effort `frame`(if children) or `rect` | never silently drop; warn |

Multiple roots: `parsePixsoNodes()` returns `SceneNode[]`; Toolbar adds each and
fits the viewport to all of them. `parsePixsoJson()` is kept (returns the first)
for backward compatibility.

## Scope: properties (added on top of current coverage)

Common (`BaseNode`), applied to every node where present:
- `opacity` (node-level)
- Full **fill stack** → `fills: Paint[]` (solid + gradient + image), preserving
  order, per-paint `opacity`/`visible`/`blendMode`. Image paints become an
  `ImagePaint` when the payload carries image bytes (`images`/`imageRef` map,
  data URL); otherwise the image paint is skipped and a warning logged.
- Full **stroke stack** first solid → `stroke`; `strokeAlign`; per-side weights.
- **effects[]** → `DROP_SHADOW`→outer shadow, `INNER_SHADOW`→inner shadow,
  `LAYER_BLUR`→blur, `BACKGROUND_BLUR`→background-blur.
- `rotation` normalization (Figma degrees are counter-clockwise; negate to our
  clockwise convention).

Frame/rect: `cornerSmoothing`, `clipsContent`→`clip`, `layoutGrids` (best-effort
type/color/count), auto-layout `layoutWrap`→`flexWrap`, counter-axis `STRETCH`
alignItems, per-axis `SPACE_BETWEEN`, `min/maxWidth/Height` sizing clamps.
Child-level: `layoutPositioning ABSOLUTE`→`absolutePosition`, `layoutGrow`/
`layoutAlign STRETCH`→`sizing` fill.

Ellipse: `arcData`.

Text: `textCase`→`textTransform`, `textAutoResize`→`textWidthMode`, numeric
`fontWeight` from `fontName.style`, `hyperlink`→`link`, `paragraphSpacing`,
`maxLines`, `textTruncation`→`truncateText`.

## Non-goals / documented fallbacks

- Component **instances stay flattened** — a partial Pixso export doesn't carry
  the master with ids matching our generated ids, so a `ref` would dangle.
- **Connectors** import as a straight line (endpoints reference live scene node
  ids we don't have).
- **Dashed strokes**, per-character text runs, luminance masks, blend modes with
  no Pixi/paint equivalent are skipped (warned, not fatal).
- Image paints without embedded bytes are skipped.

## Testing

New `src/utils/__tests__/pixsoImportUtils.test.ts` (Vitest, no DOM/WebGL):
one focused test per node type and per property group, asserting the produced
`SceneNode` shape. Round-trip-ish fixtures built from realistic Pixso JSON
snippets. Existing build/lint/e2e stay green.

## Rollout

Bump `pen-editor` minor version, commit, push to `main`. Backend untouched
(import is purely client-side; no tool schema change).
