import type { ToolHandler } from "../../toolRegistry";
import { attachSnapshot, callBrowserBridge, resultError, safeParseObject } from "./shared";

/**
 * browse_open — opens (creating if needed) the desktop shell's built-in
 * browser tab, navigates to `url`, and returns `{ url, title }` for the
 * final URL after any redirects. See the design doc's §4 for the argument
 * shape (owned by the backend zod schema) and §5 for the preload call this
 * forwards to.
 *
 * Full browser use follow-up (browse-speed-contract.md, "Frontend" item 2):
 * a successful open also attaches a fresh `snapshot` — the model usually
 * doesn't need a separate browse_snapshot call right after navigating. Only
 * on success: attaching a snapshot to an `{ error }` result would bury the
 * failure under an unrelated field and imply the open landed something to
 * act on when it didn't.
 */
export const browseOpen: ToolHandler = async (args) => {
  const browser = window.penDesktop?.browser;
  const resultStr = await callBrowserBridge(
    browser ? (a) => browser.open(a as { url: string }) : undefined,
    args
  );
  if (!browser) return resultStr;

  const parsed = safeParseObject(resultStr);
  if (resultError(parsed)) return resultStr;

  return JSON.stringify(await attachSnapshot(browser, parsed));
};
