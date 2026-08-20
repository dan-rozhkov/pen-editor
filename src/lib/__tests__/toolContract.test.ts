import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { BRIDGED_MCP_TOOL_NAMES, STATIC_MCP_TOOL_NAMES } from "@/lib/mcpToolNames";
import { toolHandlers } from "@/lib/toolRegistry";
import { guidelines as clientGuidelines } from "@/lib/tools/staticTools";

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
  "read_embed_html",
  "edit_embed_html",
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
  "set_export_settings",
  "export_layers_svg",
  "read_comments",
  "reply_comment",
  "resolve_comment",
  "leave_comment",
  "create_plugin",
  "update_plugin",
  "list_plugins",
  "ask_user",
  "draw_vector",
  "analyze_image",
  "publish_to_showcase",
  "remove_background",
  "vectorize_image",
];

// Tools whose schema also has a backend `execute` — they run server-side, the
// frontend handlers are local fallbacks and are never reached via onToolCall.
const BACKEND_EXECUTED_TOOLS = [
  "get_guidelines",
  "get_style_guide_tags",
  "get_style_guide",
  "analyze_image",
];

// get_screenshot is now a real (client-executed) backend schema too — see
// pen-editor-backend/docs/specs/2026-08-14-agent-vision-design.md — so there
// are currently no frontend-only handlers.
const FRONTEND_ONLY_TOOLS: string[] = [];

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

// MCP bridged tool names (pen-editor-backend/src/mcp/server.ts
// BRIDGED_TOOL_NAMES), imported from src/lib/mcpToolNames.ts — the single
// source shared with desktopMcpBridge.ts, so the two can't silently drift.
// That module's list is still, by necessity, hand-copied against the
// backend's tool-name list across the repo boundary;
// pen-editor-backend/test/mcp-tools-contract.test.ts pins the same list on
// the backend side.
const EXPECTED_BRIDGED_MCP_TOOLS = BRIDGED_MCP_TOOL_NAMES;

describe("MCP bridged tool contract", () => {
  it("every bridged MCP tool name has a toolHandlers entry", () => {
    for (const name of EXPECTED_BRIDGED_MCP_TOOLS) {
      expect(name in toolHandlers, name).toBe(true);
    }
  });
});

// Guard for finding 4 (desktop-mcp-bridge review): desktopMcpBridge.ts
// advertises the 3 static guideline tools to the desktop shell under the name
// STATIC_MCP_TOOL_NAMES (src/lib/mcpToolNames.ts). The two lists describe
// overlapping-but-distinct concepts — backend-executed vs.
// desktop-advertised-static — that happened to be identical before
// analyze_image (2026-08-14, agent-vision-design): analyze_image is
// backend-executed like the guideline tools, but it is not part of the
// desktop MCP bridge's static allow-list (it isn't in DESKTOP_MCP_TOOL_NAMES
// at all), so the sets have diverged on purpose. What must still hold is the
// subset direction: everything the desktop bridge advertises as "static" is
// in fact backend-executed — a static tool that silently stopped being
// backend-executed would break under the bridge.
describe("static MCP tool list matches the backend-executed tool list", () => {
  it("every STATIC_MCP_TOOL_NAMES entry is backend-executed", () => {
    for (const name of STATIC_MCP_TOOL_NAMES) {
      expect(BACKEND_EXECUTED_TOOLS, name).toContain(name);
    }
  });
});

// Vitest runs with cwd = pen-editor/, the sibling backend repo lives next to it.
const backendToolsPath = resolve(
  process.cwd(),
  "../pen-editor-backend/src/ai/tools.ts"
);
const backendMcpServerPath = resolve(
  process.cwd(),
  "../pen-editor-backend/src/mcp/server.ts"
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

  it("there are no frontend-only handlers", async () => {
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

  it("this file's hardcoded bridged-tool list matches the backend's BRIDGED_TOOL_NAMES", async () => {
    const mod = (await import(
      /* @vite-ignore */ backendMcpServerPath
    )) as { BRIDGED_TOOL_NAMES: readonly string[] };
    expect([...EXPECTED_BRIDGED_MCP_TOOLS].sort()).toEqual(
      [...mod.BRIDGED_TOOL_NAMES].sort()
    );
  });
});

describe.runIf(!backendExists)("backend penTools sync (skipped)", () => {
  it.skip("pen-editor-backend not found next to pen-editor", () => {});
});

// GUIDELINES (pen-editor-backend/src/ai/tools.ts) is not exported — it backs
// both the built-in chat agent's get_guidelines execute and the MCP server's
// get_guidelines. staticTools.ts's `guidelines` map is a hand-maintained copy
// used when the desktop bridge runs get_guidelines in the page instead of on
// the backend (see plans/desktop-mcp-bridge.md finding 0.3). Reconstruct the
// backend's map through the exported getGuidelinesImpl rather than exporting
// GUIDELINES itself, so this test never needs a backend source change.
describe.runIf(backendExists)("get_guidelines content sync", () => {
  type GetGuidelinesResult =
    | { topic: string; guidelines: string }
    | { error: string };

  async function loadBackendGuidelines(): Promise<Record<string, string>> {
    const mod = (await import(
      /* @vite-ignore */ backendToolsPath
    )) as { getGuidelinesImpl: (topic: string) => Promise<GetGuidelinesResult> };

    // An unknown topic's error message lists every real topic — the only way
    // to discover the backend's full topic set without exporting GUIDELINES.
    const probe = await mod.getGuidelinesImpl("__nonexistent_topic_probe__");
    if (!("error" in probe)) {
      throw new Error(
        "Expected getGuidelinesImpl to reject an unknown topic with an error listing available topics"
      );
    }
    const match = probe.error.match(/Available topics: (.+)$/);
    if (!match) {
      throw new Error(`Could not parse available topics from: ${probe.error}`);
    }
    const topics = match[1].split(", ");

    const entries = await Promise.all(
      topics.map(async (topic) => {
        const result = await mod.getGuidelinesImpl(topic);
        if ("error" in result) {
          throw new Error(
            `Unexpected error fetching backend guidelines for topic "${topic}": ${result.error}`
          );
        }
        return [topic, result.guidelines] as const;
      })
    );
    return Object.fromEntries(entries);
  }

  it("client guidelines topics match the backend's (same shape)", async () => {
    const backendGuidelines = await loadBackendGuidelines();
    expect(Object.keys(clientGuidelines).sort()).toEqual(
      Object.keys(backendGuidelines).sort()
    );
  });

  it("client guidelines content is byte-identical to the backend's", async () => {
    const backendGuidelines = await loadBackendGuidelines();
    expect(clientGuidelines).toEqual(backendGuidelines);
  });
});
