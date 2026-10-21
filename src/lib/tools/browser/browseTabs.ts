import type { ToolHandler } from "../../toolRegistry";
import { executeBrowseTool } from "@sideform/browser-agent/agent/execute";
import { getBrowserBridge } from "./bridge";
import { peBase, withSecrets } from "./shared";

/**
 * browse_tabs — list/switch/close/open the built-in browser tabs.
 * The mapping onto the bridge lives in the package (`executeBrowseTool`);
 * this handler only supplies the bridge and this app's texts.
 */
export const browseTabs: ToolHandler = (args, context) =>
  executeBrowseTool(getBrowserBridge(context?.sessionId, context?.browserSession), "browse_tabs", args, withSecrets(peBase, context?.sessionId));
