/**
 * Which client-executed tools the agent panel runs itself and which it sends
 * to the bound canvas tab. The panel has NO scene but HAS its own browser
 * bridge (`window.penAgentPanel.browser`), so it runs every tool that needs
 * neither scene nor canvas-tab-only state: ask_user, analyze_image, the static
 * guideline tools ALL `browse_*` / `qa_*` tools and the `doc_*` markdown-document tools. Every other tool runs in
 * the canvas tab. The one scene write a browser tool does (placing a node via
 * `placeNodeOnCanvas`) goes to the canvas tab as a `place-node` message.
 */

const PANEL_LOCAL_PREFIXES = ["browse_", "qa_", "doc_"] as const;

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
