import type { ToolHandler } from "../../toolRegistry";
import { callBrowserBridge } from "./shared";

/**
 * browse_open — opens (creating if needed) the desktop shell's built-in
 * browser tab, navigates to `url`, and returns `{ url, title }` for the
 * final URL after any redirects. See the design doc's §4 for the argument
 * shape (owned by the backend zod schema) and §5 for the preload call this
 * forwards to.
 */
export const browseOpen: ToolHandler = async (args) => {
  const browser = window.penDesktop?.browser;
  return callBrowserBridge(
    browser ? (a) => browser.open(a as { url: string }) : undefined,
    args
  );
};
