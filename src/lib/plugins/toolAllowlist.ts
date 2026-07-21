/**
 * Tools a plugin may invoke via pen.tools.run. Deliberately excludes:
 * comments (agent-facing workflow), get_screenshot (WebGL / heavy),
 * backend-static guideline tools (meaningless client-side),
 * generate_frame_image (needs screenshot pipeline).
 */
export const PLUGIN_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "batch_design",
  "batch_get",
  "get_editor_state",
  "snapshot_layout",
  "get_variables",
  "set_variables",
  "get_text_styles",
  "set_text_styles",
  "apply_text_style",
  "get_styles",
  "set_styles",
  "apply_fill_style",
  "apply_effect_style",
  "replace_all_matching_properties",
  "search_all_unique_properties",
  "find_empty_space_on_canvas",
  "rename_layers",
  "boolean_operation",
  "set_export_settings",
  "generate_image",
]);

/**
 * Non-mutating subset of `PLUGIN_ALLOWED_TOOLS`: pure reads/queries against
 * the scene graph that never write to it. Dev Mode (the read-only inspect
 * overlay, `devModeStore`) restricts `pen.tools.run` — and `pen.scene.batch`,
 * which routes through the same `batch_design` tool — to this subset (see
 * `runTool` in `pluginApi.ts`), so a plugin whose panel is already open can't
 * bypass the read-only guarantee that the Manager's disabled Run button and
 * the hidden command-palette entries already enforce elsewhere.
 *
 * Every other allowlisted tool mutates the scene (`batch_design`,
 * `set_variables`, `set_text_styles`, `apply_text_style`, `set_styles`,
 * `apply_fill_style`, `apply_effect_style`, `replace_all_matching_properties`,
 * `rename_layers`, `boolean_operation`, `set_export_settings`,
 * `generate_image` — the last one writes a generated image fill onto a
 * node) and is therefore excluded.
 */
export const READ_ONLY_PLUGIN_TOOLS: ReadonlySet<string> = new Set([
  "batch_get",
  "get_editor_state",
  "snapshot_layout",
  "get_variables",
  "get_text_styles",
  "get_styles",
  "search_all_unique_properties",
  "find_empty_space_on_canvas",
]);
