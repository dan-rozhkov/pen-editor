import type { ToolHandler } from "../../toolRegistry";
import { BROWSER_BRIDGE_METHOD_MISSING_ERROR, callBrowserBridge } from "./shared";

/**
 * browse_screenshot — a viewport capture of the built-in browser tab
 * (docs/superpowers/specs/2026-09-23-full-browser-use-design.md, "Desktop
 * bridge"). Returns `{ imageData: "data:image/jpeg;base64,…", width,
 * height, url, title, snapshotId?, elements? }` — the backend's
 * `toModelOutput` turns `imageData` into an image part the same way
 * `get_screenshot`'s does, so this handler must not touch or re-encode it.
 * `annotate: true` numbers every snapshot element on the image itself
 * (set-of-marks) and returns `snapshotId`/`elements` alongside it for a
 * following index-targeted `browse_act`. Thin forwarder onto
 * `window.penDesktop.browser.screenshot`, same conventions as its browse_*
 * siblings — except this bridge method is new enough that an older desktop
 * build may have `window.penDesktop.browser` but lack `.screenshot`, so
 * that case gets its own, more actionable error instead of the generic
 * "browser not available" one.
 */
export const browseScreenshot: ToolHandler = async (args) => {
  const browser = window.penDesktop?.browser;
  const call = browser?.screenshot
    ? (a: Record<string, unknown>) => browser.screenshot!(a)
    : undefined;
  const unavailableMessage =
    browser && !browser.screenshot ? BROWSER_BRIDGE_METHOD_MISSING_ERROR : undefined;
  return callBrowserBridge(call, args, unavailableMessage);
};
