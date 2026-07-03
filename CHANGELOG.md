# Changelog

All notable changes to **pen-editor** (frontend) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While on `0.x`, minor bumps may include breaking changes.

## [Unreleased]

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

[Unreleased]: https://github.com/dan-rozhkov/pen-editor/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/dan-rozhkov/pen-editor/releases/tag/v0.4.0
