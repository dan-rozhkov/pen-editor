import type { ToolHandler } from "../../toolRegistry";
import { callBrowserBridge } from "./shared";

/**
 * browse_find_images — collects images (`<img>` + background-image
 * elements) from the built-in browser tab's current page, filtered by
 * minWidth/minHeight and capped at `limit`. Returned URLs go straight onto
 * the canvas via `imageFill.url` — no new image plumbing needed (design doc
 * §4). This handler is a thin forwarder onto the preload bridge.
 */
export const browseFindImages: ToolHandler = async (args) => {
  const browser = window.penDesktop?.browser;
  return callBrowserBridge(browser ? (a) => browser.findImages(a) : undefined, args);
};
