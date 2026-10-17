import type { ToolHandler } from "../../toolRegistry";
import { executeBrowseTool } from "@sideform/browser-agent/agent/execute";
import { getBrowserBridge } from "./bridge";
import { peBase } from "./shared";

/**
 * browse_open — opens the built-in browser tab at `url`; a success carries a fresh `snapshot`.
 * The mapping onto the bridge lives in the package (`executeBrowseTool`);
 * this handler only supplies the bridge and this app's texts.
 */
export const browseOpen: ToolHandler = (args, context) =>
  executeBrowseTool(getBrowserBridge(context?.sessionId, context?.browserSession), "browse_open", args, peBase);
