import type { ToolHandler } from "../../toolRegistry";
import { executeBrowseTool } from "@sideform/browser-agent/agent/execute";
import { getBrowserBridge, isDesktopBrowserAvailable } from "./bridge";
import { appArgOf } from "./isolation";
import { peBase, withSecrets } from "./shared";

export const APP_NEEDS_DESKTOP_ERROR =
  "Launching an app works only in Sideform Desktop. Use `url` to open a web page instead.";

/**
 * browse_open — opens the built-in browser tab at `url`; a success carries a fresh `snapshot`.
 * The mapping onto the bridge lives in the package (`executeBrowseTool`);
 * this handler only supplies the bridge and this app's texts.
 */
export const browseOpen: ToolHandler = async (args, context) => {
  // An app is driven only by the desktop shell: never route it to the cloud browser.
  if (appArgOf(args) !== undefined && !isDesktopBrowserAvailable()) {
    return JSON.stringify({ error: APP_NEEDS_DESKTOP_ERROR });
  }
  return executeBrowseTool(getBrowserBridge(context?.sessionId, context?.browserSession), "browse_open", args, withSecrets(peBase, context?.sessionId));
};
