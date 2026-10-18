import type { ToolHandler } from "../toolRegistry";
import { getPanelClient } from "../canvasLink/panelRuntime";

// Panel-local (canvasLink/canvasTools.ts): binds the calling chat to a canvas tab of the desktop
// agent panel, optionally opening one. Advertised by the backend only when
// clientCapabilities.canvasTabs is true. Output: {tabId, title, opened} or {error}.
export const openCanvasTab: ToolHandler = async (args, context) => {
  const client = getPanelClient();
  if (!client) {
    return JSON.stringify({ error: "open_canvas_tab works only in the desktop app's agent panel." });
  }
  const target = (args as { target?: unknown } | null)?.target;
  if (target !== "new" && target !== "current") {
    return JSON.stringify({ error: 'target must be "new" or "current".' });
  }
  const sessionId = context?.sessionId;
  if (!sessionId) return JSON.stringify({ error: "No chat is bound to this call." });
  const result = await client.bindExplicit(sessionId, target, context?.signal);
  return JSON.stringify(result);
};
