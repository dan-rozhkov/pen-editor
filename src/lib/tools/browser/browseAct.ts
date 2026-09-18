import type { ToolHandler } from "../../toolRegistry";
import { callBrowserBridge } from "./shared";

/**
 * browse_act — drives the built-in browser tab: click/type/scroll/back/
 * forward. Argument validation (target/text/amount shape per action) lives
 * on the desktop side's `BrowserController`, since these arguments arrive
 * from an LLM through a renderer and that controller is the trust boundary
 * (design doc §3). This handler is a thin forwarder.
 */
export const browseAct: ToolHandler = async (args) => {
  const browser = window.penDesktop?.browser;
  return callBrowserBridge(browser ? (a) => browser.act(a) : undefined, args);
};
