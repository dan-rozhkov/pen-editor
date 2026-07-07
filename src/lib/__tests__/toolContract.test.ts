import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { toolHandlers } from "@/lib/toolRegistry";

/**
 * The tool names the frontend can execute. This list is the contract between
 * the backend schemas (pen-editor-backend/src/ai/tools.ts) and the client-side
 * registry — update both sides together when adding/removing a tool.
 */
const EXPECTED_CLIENT_TOOLS = [
  "get_editor_state",
  "batch_get",
  "snapshot_layout",
  "get_screenshot",
  "get_variables",
  "batch_design",
  "set_variables",
  "get_text_styles",
  "set_text_styles",
  "apply_text_style",
  "get_styles",
  "set_styles",
  "apply_fill_style",
  "apply_effect_style",
  "replace_all_matching_properties",
  "find_empty_space_on_canvas",
  "search_all_unique_properties",
  "rename_layers",
  "boolean_operation",
  "get_guidelines",
  "get_style_guide_tags",
  "get_style_guide",
  "generate_image",
  "generate_frame_image",
];

// Tools whose schema also has a backend `execute` — they run server-side, the
// frontend handlers are local fallbacks and are never reached via onToolCall.
const BACKEND_EXECUTED_TOOLS = [
  "get_guidelines",
  "get_style_guide_tags",
  "get_style_guide",
];

// get_screenshot is declared only on the frontend (the backend schema is
// commented out), so it is the only allowed frontend-extra name.
const FRONTEND_ONLY_TOOLS = ["get_screenshot"];

describe("tool registry contract", () => {
  it("toolHandlers contains exactly the expected tool names", () => {
    expect(Object.keys(toolHandlers).sort()).toEqual(
      [...EXPECTED_CLIENT_TOOLS].sort()
    );
  });

  it("every handler is a function", () => {
    for (const name of Object.keys(toolHandlers)) {
      expect(typeof toolHandlers[name], name).toBe("function");
    }
  });
});

// Vitest runs with cwd = pen-editor/, the sibling backend repo lives next to it.
const backendToolsPath = resolve(
  process.cwd(),
  "../pen-editor-backend/src/ai/tools.ts"
);
const backendExists = existsSync(backendToolsPath);

// In the cross-repo CI job the sibling checkout is mandatory — a missing
// backend must fail the job, not silently skip the contract.
if (process.env.CONTRACT_REQUIRE_BACKEND && !backendExists) {
  throw new Error(
    `CONTRACT_REQUIRE_BACKEND is set but ${backendToolsPath} does not exist`
  );
}

describe.runIf(backendExists)("backend penTools sync", () => {
  async function loadPenTools(): Promise<Record<string, { execute?: unknown }>> {
    const mod = (await import(
      /* @vite-ignore */ backendToolsPath
    )) as { penTools: Record<string, { execute?: unknown }> };
    return mod.penTools;
  }

  it("every backend tool schema has a frontend handler", async () => {
    const penTools = await loadPenTools();
    const missing = Object.keys(penTools).filter(
      (name) => !(name in toolHandlers)
    );
    expect(missing).toEqual([]);
  });

  it("frontend-only handlers are limited to get_screenshot", async () => {
    const penTools = await loadPenTools();
    const frontendOnly = Object.keys(toolHandlers).filter(
      (name) => !(name in penTools)
    );
    expect(frontendOnly.sort()).toEqual([...FRONTEND_ONLY_TOOLS].sort());
  });

  it("only the static tools execute on the backend", async () => {
    const penTools = await loadPenTools();
    const backendExecuted = Object.entries(penTools)
      .filter(([, tool]) => typeof tool.execute === "function")
      .map(([name]) => name);
    expect(backendExecuted.sort()).toEqual([...BACKEND_EXECUTED_TOOLS].sort());
  });
});

describe.runIf(!backendExists)("backend penTools sync (skipped)", () => {
  it.skip("pen-editor-backend not found next to pen-editor", () => {});
});
