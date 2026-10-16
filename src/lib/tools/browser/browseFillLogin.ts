import type { ToolHandler } from "../../toolRegistry";
import { getBrowserBridge } from "./bridge";
import { callBrowserBridge } from "./shared";

/**
 * browse_fill_login — fills the saved login for the current page's origin in the
 * desktop built-in browser (pen-editor-desktop docs/superpowers/specs/
 * 2026-10-16-browser-saved-logins-design.md). The secret never passes through
 * here: the shell reads it and types it into the page; the result is
 * `{ ok, origin, label, filled, submitted }`. Only `{ label, submit }` reach the
 * bridge. Args and result are never logged.
 */
export const FILL_LOGIN_UNAVAILABLE_ERROR = "Saved logins are available only in the desktop app.";

export const browseFillLogin: ToolHandler = async (args, context) => {
  const browser = getBrowserBridge(context?.sessionId);
  const fill = browser?.fillLogin;

  const bridgeArgs: { label?: string; submit?: boolean } = {};
  if (typeof args.label === "string" && args.label.trim()) bridgeArgs.label = args.label.trim();
  if (typeof args.submit === "boolean") bridgeArgs.submit = args.submit;

  return callBrowserBridge(
    fill ? (a) => fill.call(browser, a as { label?: string; submit?: boolean }) : undefined,
    bridgeArgs,
    FILL_LOGIN_UNAVAILABLE_ERROR,
  );
};
