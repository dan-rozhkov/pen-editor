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
