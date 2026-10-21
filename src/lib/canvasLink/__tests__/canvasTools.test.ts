import { describe, expect, it } from "vitest";
import { toolHandlers } from "@/lib/toolRegistry";
import { PANEL_LOCAL_FIXED_TOOL_NAMES, runsInCanvasTab } from "../canvasTools";

const PANEL = [
  "ask_user",
  "analyze_image",
  "open_canvas_tab",
  "doc_list", "doc_create", "doc_read", "doc_edit", "doc_insert_image", "doc_open",
  "workflow_list", "workflow_create", "workflow_read", "workflow_edit", "workflow_open",
  "trace_list", "trace_read",
  "get_guidelines",
  "get_style_guide",
  "get_style_guide_tags",
  "browse_open", "browse_act", "browse_find_images", "browse_read", "browse_snapshot",
  "browse_screenshot", "browse_tabs", "browse_capture", "browse_fill_login", "browse_task",
  "browse_agent", "qa_verdict", "qa_assert",
];

// Every other tool runs in the canvas tab. A new tool must be added here
// consciously (and, if it needs no scene, to PANEL).
const CANVAS = [
  "get_editor_state", "batch_get", "snapshot_layout",
  "get_screenshot", "get_variables", "batch_design", "read_embed_html", "edit_embed_html",
  "define_component", "extract_component", "detach_instance", "delete_component", "set_variables",
  "get_text_styles", "set_text_styles", "apply_text_style", "get_styles", "set_styles",
  "apply_fill_style", "apply_effect_style", "replace_all_matching_properties",
  "find_empty_space_on_canvas", "search_all_unique_properties", "rename_layers", "boolean_operation",
  "generate_image", "generate_frame_image", "set_export_settings", "export_layers_svg",
  "read_comments", "reply_comment", "resolve_comment", "leave_comment",
  "create_plugin", "update_plugin", "list_plugins", "draw_vector", "generate_vector",
  "publish_to_showcase", "remove_background", "vectorize_image",
  "read_design_repo", "read_repo_files", "attach_local_repo",
];

describe("tool placement", () => {
  it("classifies every registered tool consciously", () => {
    const expected = new Map<string, boolean>([
      ...PANEL.map((n): [string, boolean] => [n, false]),
      ...CANVAS.map((n): [string, boolean] => [n, true]),
    ]);
    expect(expected.size).toBe(PANEL.length + CANVAS.length);
    expect(Object.keys(toolHandlers).sort()).toEqual([...expected.keys()].sort());
    for (const name of Object.keys(toolHandlers)) {
      expect(runsInCanvasTab(name), name).toBe(expected.get(name));
    }
  });

  it("fixed panel-local set is exact (browse_*/qa_*/doc_*/workflow_* come by prefix)", () => {
    expect([...PANEL_LOCAL_FIXED_TOOL_NAMES].sort()).toEqual(
      PANEL.filter((n) => !/^(browse|qa|doc|workflow|trace)_/.test(n)).sort()
    );
  });
});
