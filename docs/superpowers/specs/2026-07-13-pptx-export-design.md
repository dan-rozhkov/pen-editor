# PPTX Export (Slides Mode) — Design

**Date:** 2026-07-13
**Status:** Approved (design), implementation not started
**Scope:** Editable `.pptx` export of the Slides view (top-level frames), alongside the existing raster PDF export.

## Goal

Export the document's slides (top-level frames, in SlidesPanel order) as a PowerPoint `.pptx` file where nodes become *editable* PowerPoint objects (shapes, text boxes, pictures) wherever a faithful mapping exists, with a per-node raster fallback for everything else. No new runtime dependencies.

## Decisions (with rationale)

- **Fully editable export**, not raster-per-slide. User decision; raster fidelity is already covered by PDF export.
- **Hand-written DrawingML + `fflate`** (already a dependency, has `zipSync`) instead of `pptxgenjs`. pptxgenjs adds ~123 KB gzip (incl. jszip, duplicating fflate) and — critically — still has **no gradient fill support** ([issue #102](https://github.com/gitbrent/PptxGenJS/issues/102), open since 2017), which would force rasterizing exactly the shapes a design tool cares about. Writing DrawingML directly gives full control (gradients, shadows, custGeom) at ~2× the code size.
- **Per-node raster fallback** is a mandatory layer: shaders, blurs, masks, embeds, pattern/video fills cannot be represented in PowerPoint. Unmappable subtrees are rasterized via the existing Pixi `extract.canvas` pipeline and placed as picture shapes at their absolute rects. A mapper error for any node also degrades to raster — a slide never fails as a whole.
- **Slide order = SlidesPanel order**: `getTopLevelFramesFlat(nodesById, rootIds)` (plain `rootIds`). Note this is the *reverse* of the PDF export's `getTopLevelFrames()` (reversed `rootIds`); the PPTX export must match what the Slides panel shows.

## Architecture

Mirrors the PDF export's pure-assembly / Pixi-orchestration split:

```
src/lib/pptxExport/            # pure, no WebGL — unit-testable like assemblePdf.ts
  opc.ts                       # OPC packaging: [Content_Types].xml, _rels, fflate zipSync
  xml.ts                       # helpers: XML escaping, px→EMU (1px = 9525 EMU),
                               # degrees→rot units (1° = 60000), color/alpha formatting
  drawingml/
    shapeProps.ts              # <p:spPr>: a:xfrm, a:prstGeom / a:custGeom,
                               # fills (solidFill / gradFill / blipFill), a:ln, a:effectLst (shadow)
    textBody.ts                # <p:txBody>: paragraphs, runs (font family/size/weight/italic/color),
                               # alignment, line-height
    mappers.ts                 # ShapeInput → shape XML string; dispatch table by node type
  assemblePptx.ts              # (slides: SlideInput[], opts) → Uint8Array
src/utils/exportPptxUtils.ts   # Pixi/store layer: walk resolved node tree, absolute rects
                               # from calculateFrameLayout/layoutStore, needsRaster() decisions,
                               # per-node extract.canvas raster fallback, downloadBlob
```

### Intermediate representation (IR)

`assemblePptx` takes a fully resolved IR so all Pixi/store logic stays outside:

```ts
interface SlideInput {
  widthPx: number; heightPx: number;      // slide frame size
  shapes: ShapeInput[];                   // flat, z-ordered, absolute slide-relative coords
}
type ShapeInput =
  | { kind: 'rect'; rect: Rect; rotation?: number; cornerRadii?: [n,n,n,n];
      fill?: FillInput; stroke?: StrokeInput; shadow?: ShadowInput }
  | { kind: 'ellipse'; ... }
  | { kind: 'line'; ... }
  | { kind: 'text'; rect: Rect; rotation?: number; paragraphs: ParagraphInput[] }
  | { kind: 'picture'; rect: Rect; rotation?: number; media: MediaInput };  // image fills & raster fallbacks
type FillInput = SolidFill | GradientFill /* linear + radial */ | ImageFill;
interface MediaInput { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' }
```

Media parts are deduplicated by content hash before packaging.

## Node mapping (v1)

| Node | PowerPoint |
|---|---|
| `frame`, `rectangle` | `p:sp` with `prstGeom` rect/roundRect (uniform radius) or `custGeom` (per-corner radii) |
| `ellipse` | `p:sp` prstGeom ellipse |
| `line` | line shape |
| `text` | `p:sp` + `txBody`: runs with font family/size/weight/italic/color; alignment; line-height. Fonts are **not embedded** — name only; viewer substitutes if missing |
| image fill | media part + `blipFill` picture shape |
| solid / gradient fill | `a:solidFill` / `a:gradFill` (linear + radial), alpha supported |
| drop/inner shadow | `a:effectLst` (`outerShdw` / `innerShdw`) |
| `polygon`, `star`, `path`, `icon_font` | **v1: raster fallback**; v2: `custGeom` from path data |
| `embed`, `note`, shader nodes, masks, layer/background blur, pattern & video fills | **raster fallback** (no faithful PPTX representation) |
| `ref` (component instances) | mapped from the resolved tree, same as rendering |
| `connection` | skipped in v1 (not part of slide content) |

`needsRaster(node)` decides fallback: unsupported type, unsupported fill/effect, or active mask. Rasterization uses the existing `extract.canvas({ target, resolution, frame })` + `withForcedRenderable` machinery from `exportPdfUtils.ts` (extracted for reuse), applied to the node's container; the resulting PNG is placed at the node's absolute rect and its subtree is not walked further.

## Slide geometry

- PPTX has **one slide size per presentation**: taken from the first slide frame (default 960×540 px → 12192000×6858000 EMU — exactly the standard 16:9 size). Frames of other sizes are scaled proportionally to fit and centered.
- Absolute node rects come from `getNodeEffectiveSize` / `calculateFrameLayout` (Yoga-resolved auto-layout), relative to the slide frame; rotation → `a:xfrm rot` (clockwise, 60000ths of a degree).
- Coordinate conversion: 1 px = 9525 EMU (96 dpi).

## UI

- **v1:** "Export PPTX" button in the SlidesPanel header (next to the existing Add-slide `PlusIcon`, `src/components/SlidesPanel.tsx`), operating on the same `getTopLevelFramesFlat` list the panel renders. Lazy `import()` of the export modules (keeps them out of the main chunk, same pattern as PDF).
- **v2 (optional):** add `'pptx'` to `ExportSettingFormat` (`src/types/scene.ts`) + a runner in `src/lib/exportSettings/runExportAll.ts` + mime/extension in `exportSettingsUtils.ts` for per-node export settings.

## Error handling

- Per-node mapper error → raster fallback for that node (log via console in dev).
- Raster fallback itself fails → skip the node, continue the slide.
- Assembly/download error → toast with message (same UX as other exports); no partial file download.

## Testing

- **`assemblePptx` / `opc`:** unzip the output with fflate *in the test*, assert required parts exist (`[Content_Types].xml`, `_rels/.rels`, `ppt/presentation.xml`, `ppt/slides/slideN.xml`, `ppt/slides/_rels/*`, media), and each XML part is well-formed (DOMParser, no `parsererror`).
- **Mappers:** string/snapshot assertions per node kind (rect radii → custGeom, gradient stops, text runs, rotation units, EMU math).
- **Pixi layer:** mocked extract, same style as PDF export tests; verify slide ordering matches SlidesPanel and `needsRaster` routing.
- **Manual:** open the exported file in PowerPoint, Keynote, and Google Slides (cannot be automated; a corrupt-package bug shows up here first).
- E2E: not covered (WebGL extract unavailable), consistent with `get_screenshot`.

## Size estimate

~1500–2200 lines in `src/lib/pptxExport/`, ~300 lines utils/UI, ~800 lines tests. Zero bundle-size cost (no new dependencies; export code is lazy-loaded).

## Phases

- **v1:** frame/rect/ellipse/line/text, solid/gradient/image fills, shadows, raster fallback, SlidesPanel button.
- **v2:** path/polygon/star/icon_font → custGeom, text lists & links, export-settings runner, letter-spacing/OpenType niceties.

## Non-goals

- Font embedding.
- Round-trip PPTX *import*.
- Speaker notes, transitions, animations.
- Vector fidelity for shaders/blurs/masks (raster by design).
