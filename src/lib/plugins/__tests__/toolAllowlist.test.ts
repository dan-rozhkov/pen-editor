import { describe, it, expect } from "vitest";
import { toolHandlers } from "@/lib/toolRegistry";
import { PLUGIN_ALLOWED_TOOLS } from "../toolAllowlist";

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
