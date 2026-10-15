import type { ToolHandler } from "../../toolRegistry";
import { executeBrowseTool } from "@sideform/browser-agent/agent/execute";
import { getBrowserBridge } from "./bridge";
import { peBase } from "./shared";

/**
 * browse_read — a readable digest (headings, visible text, links) of the current page.
 * The mapping onto the bridge lives in the package (`executeBrowseTool`);
 * this handler only supplies the bridge and this app's texts.
 */
export const browseRead: ToolHandler = (args, context) =>
  executeBrowseTool(getBrowserBridge(context?.sessionId), "browse_read", args, peBase);
