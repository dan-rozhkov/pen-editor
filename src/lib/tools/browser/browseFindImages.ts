import type { ToolHandler } from "../../toolRegistry";
import { executeBrowseTool } from "@sideform/browser-agent/agent/execute";
import { getBrowserBridge } from "./bridge";
import { peBase } from "./shared";

/**
 * browse_find_images — images (`<img>` + background-image) of the current page.
 * The mapping onto the bridge lives in the package (`executeBrowseTool`);
 * this handler only supplies the bridge and this app's texts.
 */
export const browseFindImages: ToolHandler = (args, context) =>
  executeBrowseTool(getBrowserBridge(context?.sessionId, context?.browserSession), "browse_find_images", args, peBase);
