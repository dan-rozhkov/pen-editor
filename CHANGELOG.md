# Changelog

All notable changes to **pen-editor** (frontend) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While on `0.x`, minor bumps may include breaking changes.

## [Unreleased]

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

[Unreleased]: https://github.com/dan-rozhkov/pen-editor/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.5.0...v0.8.0
[0.5.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/dan-rozhkov/pen-editor/releases/tag/v0.4.0
