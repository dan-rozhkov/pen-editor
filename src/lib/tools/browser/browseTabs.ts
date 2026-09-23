import type { ToolHandler } from "../../toolRegistry";
import { BROWSER_BRIDGE_METHOD_MISSING_ERROR, callBrowserBridge } from "./shared";

/**
 * browse_tabs — list/switch/close/open the desktop shell's built-in browser
 * tabs (docs/superpowers/specs/2026-09-23-full-browser-use-design.md,
 * "Desktop bridge"). `new` optionally loads `url` (using `browse_open`'s
 * semantics) and makes the new tab the agent's current tab; `switch`/`close`
 * act on an existing `tabId` from a prior `list`. Thin forwarder onto
 * `window.penDesktop.browser.tabs`, same conventions as its browse_*
 * siblings — except this bridge method is new enough that an older desktop
 * build may have `window.penDesktop.browser` but lack `.tabs`, so that case
 * gets its own, more actionable error instead of the generic "browser not
 * available" one.
 */
export const browseTabs: ToolHandler = async (args) => {
  const browser = window.penDesktop?.browser;
  const call = browser?.tabs
    ? (a: Record<string, unknown>) =>
        browser.tabs!(a as { action: "list" | "switch" | "close" | "new"; tabId?: number; url?: string })
    : undefined;
  const unavailableMessage =
    browser && !browser.tabs ? BROWSER_BRIDGE_METHOD_MISSING_ERROR : undefined;
  return callBrowserBridge(call, args, unavailableMessage);
};
