import { describe, it, expect } from "vitest";
import { toolHandlers } from "@/lib/toolRegistry";
import { PLUGIN_ALLOWED_TOOLS, READ_ONLY_PLUGIN_TOOLS } from "../toolAllowlist";

describe("PLUGIN_ALLOWED_TOOLS", () => {
  it("is a subset of registered tool handlers", () => {
    for (const name of PLUGIN_ALLOWED_TOOLS) {
      expect(toolHandlers, `allowlisted tool "${name}" missing in registry`).toHaveProperty(name);
    }
  });

  it("excludes screenshot, comments and backend-static tools", () => {
    const banned = [
      "get_screenshot",
      "read_comments", "reply_comment", "resolve_comment", "leave_comment",
      "get_guidelines", "get_style_guide", "get_style_guide_tags",
    ];
    for (const name of banned) {
      expect(PLUGIN_ALLOWED_TOOLS.has(name)).toBe(false);
    }
  });

  it("includes the core scene tools", () => {
    for (const name of ["batch_design", "batch_get", "get_editor_state"]) {
      expect(PLUGIN_ALLOWED_TOOLS.has(name)).toBe(true);
    }
  });
});

describe("READ_ONLY_PLUGIN_TOOLS", () => {
  it("is a subset of PLUGIN_ALLOWED_TOOLS", () => {
    for (const name of READ_ONLY_PLUGIN_TOOLS) {
      expect(PLUGIN_ALLOWED_TOOLS.has(name), `"${name}" must also be plugin-allowed`).toBe(true);
    }
  });

  it("excludes every tool that mutates the scene", () => {
    const mutating = [
      "batch_design",
      "set_variables",
      "set_text_styles",
      "apply_text_style",
      "set_styles",
      "apply_fill_style",
      "apply_effect_style",
      "replace_all_matching_properties",
      "rename_layers",
      "boolean_operation",
      "set_export_settings",
      "generate_image",
    ];
    for (const name of mutating) {
      expect(READ_ONLY_PLUGIN_TOOLS.has(name), `"${name}" mutates and must not be read-only`).toBe(false);
    }
  });

  it("includes the core read/query tools", () => {
    for (const name of ["batch_get", "get_editor_state", "find_empty_space_on_canvas"]) {
      expect(READ_ONLY_PLUGIN_TOOLS.has(name)).toBe(true);
    }
  });
});
