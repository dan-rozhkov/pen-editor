/**
 * Which client-executed tools the agent panel runs itself and which it sends
 * to the bound canvas tab. The panel has NO scene but HAS its own browser
 * bridge (`window.penAgentPanel.browser`), so it runs every tool that needs
 * neither scene nor canvas-tab-only state: ask_user, analyze_image, the static
 * guideline tools ALL `browse_*` / `qa_*` tools the `doc_*` markdown-document tools and the `trace_*` trace-tab tools. Every other tool runs in
 * the canvas tab. The one scene write a browser tool does (placing a node via
 * `placeNodeOnCanvas`) goes to the canvas tab as a `place-node` message.
 */
import { READ_ONLY_PLUGIN_TOOLS } from "@/lib/plugins/toolAllowlist";

const PANEL_LOCAL_PREFIXES = ["browse_", "qa_", "doc_", "workflow_", "trace_"] as const;

/** Fixed (non-prefixed) tools that run in the agent panel itself. */
export const PANEL_LOCAL_FIXED_TOOL_NAMES: ReadonlySet<string> = new Set([
  // Answered by the in-chat form.
  "ask_user",
  // Looks at an image by URL; touches no scene.
  "analyze_image",
  // Binds this chat to a canvas tab; the panel owns the binding.
  "open_canvas_tab",
  // Static guideline text; touches no scene.
  "get_guidelines",
  "get_style_guide",
  "get_style_guide_tags",
]);

/** true when the tool runs in the agent panel itself. */
export function runsInPanel(toolName: string): boolean {
  return (
    PANEL_LOCAL_FIXED_TOOL_NAMES.has(toolName) || PANEL_LOCAL_PREFIXES.some((p) => toolName.startsWith(p))
  );
}

/** true when the tool must be sent to the bound canvas tab. */
export function runsInCanvasTab(toolName: string): boolean {
  return !runsInPanel(toolName);
}

/**
 * Canvas-tab tools that only look at the canvas. With no canvas tab open they do not open one: there is
 * nothing to look at. Built from `READ_ONLY_PLUGIN_TOOLS` plus the read-only tools a plugin may not run.
 */
const READ_ONLY_CANVAS_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...READ_ONLY_PLUGIN_TOOLS,
  "get_screenshot",
  "read_embed_html",
  "read_comments",
  "export_layers_svg",
]);

/** true when the tool only reads the canvas, so a chat without a canvas tab must not open one for it. */
export function isReadOnlyCanvasTool(toolName: string): boolean {
  return READ_ONLY_CANVAS_TOOL_NAMES.has(toolName);
}

/** The answer of a read-only tool when the chat has no canvas tab. It is not an error for the model. */
export const NO_CANVAS_RESULT = JSON.stringify({
  canvasOpen: false,
  note: "No canvas tab is open, so there is nothing on a canvas. Do not open one only to look. Call open_canvas_tab only when the task needs the canvas.",
});
