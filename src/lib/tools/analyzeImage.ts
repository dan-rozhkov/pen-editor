import type { ToolHandler } from "../toolRegistry";

// Backend-executed, like get_guidelines/get_style_guide/get_style_guide_tags
// (src/lib/tools/staticTools.ts): pen-editor-backend's
// makeAnalyzeImageTool (src/ai/tools.ts) attaches a real server-side
// `execute` that calls the auxiliary vision model
// (pen-editor-backend/src/services/vision.ts), so the built-in chat's
// onToolCall never reaches this handler. Unlike the three static guideline
// tools, there is no client-side equivalent to replicate here — analyzing an
// image requires the backend's configured vision model. This handler exists
// purely so the tool-name contract (toolContract.test.ts, which requires
// every penTools entry to have a frontend handler) is satisfied, and so a
// direct MCP-bridge call against this name fails with a clear message
// instead of "Unknown tool: analyze_image".
export const analyzeImage: ToolHandler = async () => {
  return JSON.stringify({
    error:
      "analyze_image only runs on the backend (via the built-in chat's LLM turn) and cannot be executed directly from the client.",
  });
};
