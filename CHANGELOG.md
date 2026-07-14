# Changelog

All notable changes to **pen-editor** (frontend) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While on `0.x`, minor bumps may include breaking changes.

## [Unreleased]

## [0.34.0] - 2026-07-14

### Added
- **DTCG design-tokens export/import.** New File-menu actions (and command-palette
  entries) **Export design tokens (.tokens.json)** and **Import design tokens…**
  bridge the editor's variables and fill/effect/text styles to the
  [Design Tokens Community Group](https://tr.designtokens.org/format/) JSON format,
  so tokens can flow through Style Dictionary and other DTCG tooling.
  - Variables map to `color`/`number` tokens (light value in `$value`, dark theme
    in `$extensions`); string variables emit without a `$type`.
  - Fill styles map to `color` (solid, with variable bindings serialized as
    `{alias}` references) or `gradient` tokens; effect-style shadows map to
    `shadow`; text styles map to `typography`.
  - Round-trip identity is preserved via `$extensions["com.peneditor"]` (original
    store id + source), so re-importing an exported file updates entities in place
    rather than duplicating them. Foreign DTCG files import via a `$type` heuristic.
  - Import merges into the stores as a single undo step. Name collisions,
    unsupported fills (image/pattern/video), blur effects, and non-numeric values
    surface as toast warnings.

### Added
- **Slides creation** — the Slides section now has a persistent divider,
  section header, and `+` action that creates and selects a new 16:9 frame.
- **Slides document header** — Slides restores the File menu and editable
  document name alongside the Pages experience.

### Fixed
- **Slide previews** — standardized preview proportions, spacing, numbering,
  hover/selection styling, and thumbnail extraction updates.

## [0.24.1] - 2026-07-11

### Fixed
- **3D layer view: planes were invisible.** Tailwind preflight's
  `img { max-width: 100% }` resolved against the absolutely-positioned (zero-width)
  stack and collapsed every snapshot plane to 0px wide. Planes now opt out with
  `max-width/height: none`. (Only reproducible in the real browser with Tailwind
  loaded — added a regression test.)
- **3D layer view: control bar was unreachable.** The bottom draw-tool palette
  (and rulers) stayed mounted over the 3D view and covered the spacing/reset/exit
  control bar. Both are now hidden while the read-only 3D view is active.

## [0.24.0] - 2026-07-11

A read-only **3D layer view** for inspecting how a frame's layers stack.

### Added
- **3D layer view** — a floating "3D" toggle (top-center of the canvas)
  explodes the selected frame's subtree into perspective-stacked planes, one
  per node in paint order. Each plane is a real Pixi snapshot
  (`renderer.extract`) of that node, so layers look exactly like the design.
  Drag to orbit, scroll to zoom, hover to highlight a layer, and a spacing
  slider controls the gap between planes; "Reset view" and Esc/"Exit" return
  to the 2D canvas. The view is read-only and does not mutate the scene — the
  Pixi canvas is hidden (never unmounted) underneath while it is active.
  New `layers3dStore`, `captureLayers` snapshot pipeline, `resolveTargetFrame`
  selection logic, and `Layers3DOverlay`/`Layers3DToggle` components.

## [0.11.0] - 2026-07-07

Fourth gap-closing batch versus Figma: richer vector shapes, pattern fills,
layer masks, and text lists.

### Added
- **Shapes: stars, ellipse arcs, arrowheads** — polygons gain a star mode
  (`innerRadiusRatio` + point count) with a toolbar Star tool; ellipses gain
  arc/donut parameters (`startAngle`/`sweepAngle`/`innerRadiusRatio`, one
  shared geometry module for Pixi and SVG export); lines gain start/end caps
  (arrow, triangle, circle, bar) rendered in Pixi and exported as SVG
  `<marker>` defs. All editable in the properties panel and creatable via
  `batch_design`.
- **Pattern fills** — a repeating image-tile paint type with scale, spacing,
  and row-offset (stagger), coexisting with the rest of the paint stack and
  blend modes on rectangles, frames, and ellipses. Baked pattern cells are
  LRU-cached; SVG tiles load at natural size; the fill editor gets a shared
  upload control.
- **Layer masks** — Figma-style `isMask`: a node masks the siblings above it
  in the same group/frame (vector masks via Graphics; per-pixel alpha masks
  for image-fill maskers), with LayersPanel indication, hidden-mask
  semantics, mask-aware hit-testing, and clip-path/mask-image parity in HTML
  export plus native `<mask>` in SVG export.
- **Text lists** — bullet and numbered lists with per-paragraph attributes
  (`paragraphs`: list type + indent level), inline editing (Enter continues
  or outdents, Tab/Shift+Tab change level on list paragraphs), Cmd+Shift+8/7
  hotkeys, hanging indents, list-aware wrap/measure/auto-size, nested
  `<ul>`/`<ol>` HTML export, and AI support via `batch_design`.

### Fixed
- Copy/paste style now transfers arrowheads, star ratio, and ellipse arc
  parameters; width/height edits keep stars star-shaped; line cap tips are
  hit-testable; the root SVG export no longer clips overflowing caps.
- Nested `clip: true` frames keep their clipping (regression caught in
  review of the mask feature); toggling `isMask` on root-level nodes takes
  effect immediately.
- Native text edits (paste, backspace line-merge, cut) and AI text updates
  keep paragraph list attributes aligned with the text; Enter deletes a
  non-collapsed selection; Tab no longer writes hidden state on plain text;
  center/right alignment is honored in list rendering.

### Performance
- Pattern sprites resize in place instead of destroy+rebake per resize tick.
- Sibling-mask resolution early-exits for mask-free scenes (was O(N²) per
  structural sync); mask dirty-tracking iterates the dirty set, not the tree.
- List text nodes skip the full Pixi rebuild on position-only updates.

## [0.10.0] - 2026-07-06

Third gap-closing batch versus Figma: typography system, flexible layouts, and
squircle corners.

### Added
- **Text styles** — named reusable text styles (family, size, weight,
  line-height, letter-spacing, transform): create from a selected text node,
  apply from the Typography section, edit centrally with propagation to every
  bound node, local override and detach (tracked via `textStyleId` +
  `textStyleOverrides`). New Text styles panel, `.pen` serialization, and
  three AI tools: `get_text_styles`, `set_text_styles`, `apply_text_style`.
- **Auto-layout wrap & min/max** — flex wrap with independent row/column gaps
  and per-child `minWidth`/`maxWidth`/`minHeight`/`maxHeight` clamps, wired
  through the layout engine, properties panel, `batch_design`, HTML
  conversion in both directions, and public `.pen` export.
- **Corner smoothing (squircle)** — Figma-formula corner smoothing (0–100%,
  60% ≈ iOS) on rectangles and frames, composing with per-corner radii; one
  shared contour implementation drives both Pixi rendering and SVG export.
- Drawing tool variants are now grouped in the toolbar.

### Changed
- The flex layout engine resolves flexible lengths iteratively per the CSS
  spec (freeze min/max violators, redistribute), so clamped children no
  longer overflow or under-fill their container; line wrapping uses clamped
  hypothetical sizes; stretch children fill the line even in hug-sized
  containers.
- History batching is reference-counted (`batchDepth`), so nested batch
  scopes compose — one AI tool call is always one undo step.
- PWA update prompt migrated to a styled sonner toast.

### Fixed
- Vector point-edit anchors no longer drift from the path shape.
- Editing a text style, deleting it, or undoing either now keeps the style
  collection and bound nodes consistent (styles are part of history
  snapshots); partial AI style updates no longer rename styles to
  "Untitled"; multi-style AI calls no longer create duplicates.
- Row-gap-only auto-layout frames survive public `.pen` export; disabling
  wrap migrates the per-axis gap back into the single gap field so the Gap
  control keeps working; interactive resize respects min/max clamps live
  instead of popping back after commit.
- Copy/paste styles transfers corner smoothing; shader-filled nodes re-bake
  their clip mask when corner geometry changes.

## [0.9.0] - 2026-07-05

Second gap-closing batch versus Figma: effects, workflow, components, AI image
editing, and full vector editing.

### Added
- **Inner shadows** — new `shadowType: "inner"` effect in the effects stack
  (x/y/blur/spread/color, multiple per node, coexists with drop shadow),
  rendered in Pixi via an inverted-alpha cutout composition; maps to
  `box-shadow: inset` in designToHtml and is settable through `batch_design`.
- **Copy/paste properties** — Cmd+Opt+C / Cmd+Opt+V (and Edit-menu items)
  transfer fills, strokes, effects, corner radius, opacity, blend mode, and
  typography between nodes, Figma-style: type-aware filtering (text styles
  never land on shapes; ref instances receive only rendered fields),
  multi-selection paste, single-step undo, and legacy↔paint-stack
  normalization so a paste always wins over stale representations.
- **Component variants & properties** — reusable components (`frame` +
  `reusable`) can declare variant/boolean/text properties bound to descendant
  fields; instances switch them from a new properties-panel section (select /
  toggle / text input) independently of manual overrides. The AI agent can
  declare and switch properties through `batch_design`, with full validation
  on the tool path; AI-facing docs corrected to the real frame/ref component
  model.
- **AI Remove Background** — one click on an image fill (or the new
  `remove_background` AI tool) cuts the subject out using BriaAI RMBG-1.4
  running entirely in the browser via onnxruntime-web: nothing is uploaded,
  the ML runtime and model are lazy-loaded on first use (excluded from the
  PWA precache), and the result replaces the fill as a PNG with alpha,
  preserving fit mode. Verified end-to-end in a live browser.
- **Pen tool & path editing** — press P to place corner anchors (click) and
  smooth anchors with symmetric Bézier handles (drag); click the first anchor
  to close, Esc/Enter to finish. Double-click or Enter on any path — including
  legacy pencil strokes, which migrate lazily — opens point editing with
  draggable anchors/handles, Alt to break handle symmetry, and correct
  undo/redo. Polygon tool hotkey moved from P to G.

### Fixed
- Style paste onto component instances no longer silently writes fields the
  instance renderer ignores; path→path style paste carries `pathStroke`; the
  style clipboard deep-copies snapshots instead of sharing live arrays.

P0 gap-closing batch versus Figma: vector, export, layout, and precision tooling.

### Added
- **Boolean operations** — Union / Subtract / Intersect / Exclude / Flatten for
  rect/ellipse/polygon/path via `martinez-polygon-clipping`; destructive result
  is a single path node with undo support. Exposed through a Properties Panel
  section, hotkeys (Cmd/Ctrl+Alt+U/S/I/X/E), and a new client-executed
  `boolean_operation` AI tool.
- **SVG export** — scene-graph → SVG serializer (shapes as native primitives,
  linear/radial gradients, drop shadow, layer blur, stroke-align emulation);
  embed/shader/ref nodes degrade to a placeholder with a warning. New "SVG"
  option in the Export panel.
- **Layout constraints** — per-child min/max/center/stretch/scale on each axis;
  children recompute when a non-auto-layout frame is resized. Constraints
  section (cross widget + H/V selects) and `batch_design` support for the AI.
- **Rulers & guides** — toggleable rulers (Shift+R) with zoom-aware labels and
  persistent draggable guides that objects snap to; guides round-trip through
  `.pen`.
- **Per-corner radius via AI** — `batch_design` accepts `cornerRadius` as a
  number or `[tl, tr, br, bl]` array (CSS-shorthand aware).

### Note
- Changelog gap: releases 0.6.0 (layer blur) and 0.7.0/0.7.1 (PWA) shipped but
  were not logged here at the time.

## [0.5.0] - 2026-07-03

Multi-fill (Figma-style paint stack) parity: paint stacks now survive the full
node lifecycle — paste from Figma, edit, clone, export, and AI serialization.

### Added
- **Paint stack in public `.pen` export** — nodes with 2+ visible fills export a
  `fills` array (bottom-to-top); single-fill nodes keep the scalar `fill` shape.
- **Paint stack in path/polygon SVG export** — stacked shape elements with
  `<defs>` gradients; stroke emitted once on the topmost layer.
- **Per-fill opacity control** — percent input in the fill popover, for all
  paint types (model stores 0–1; Figma-pasted layer opacity is now editable).

### Fixed
- Converting a reusable frame to a component instance (`ref`) no longer drops
  the frame's `fills` and `effects` stacks.
- AI state serialization resolves per-paint `colorBinding` variables inside
  `fills[]` (previously only the legacy `fillBinding` was resolved).
- Legacy `gradientFill`/`imageFill` nodes with `fillOpacity` keep their opacity
  in public `.pen` export.

## [0.4.0] - 2026-07-03

First tracked release. Summarizes the features shipped up to this point.

### Added
- **AI image generation** — `generate_image` and `generate_frame_image` client
  handlers; data:image URLs render inline in chat; "Generate image" quick action.
- **Shader nodes** — curated shader registry + prop builder, a `ShaderConfig` on
  any node, and a properties-panel Shader section with presets and param controls.
  Shaders render **inside Pixi**, baked to a texture so they respect scene z-order.
- **Agent-on-canvas for embeds** — on-canvas agent affordance for selected embed
  nodes (`EmbedAgentButton`), selection-only (no screenshot).
- **Figma-style selection navigation** — one-level drill on double-click with
  scope-chain hit testing; Tab / Shift+Tab move selection between sibling nodes.
- **View mode** — disables node hover highlight and clears selection.

### Changed
- Shaders migrated from a DOM overlay (`ShaderLayer`) to Pixi-baked textures, so a
  shader node can sit under/between other nodes.
- Refactored on-canvas agent code: shared `launchNodeAgentChat` core and a
  generic `NodeAgentButton` (frame button became a thin wrapper).

### Fixed
- Various shader polish: propagate shader on clone/export, gate image filters,
  robust clipping, guard unknown shader kinds, hide overlay for hidden ancestors.
- Align inline frame-name editor with the canvas label position.
- Remove double-shaded blue on the selected layer row.

[Unreleased]: https://github.com/dan-rozhkov/pen-editor/compare/v0.30.0...HEAD
[0.30.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.29.0...v0.30.0
[0.11.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.5.0...v0.8.0
[0.5.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/dan-rozhkov/pen-editor/releases/tag/v0.4.0
