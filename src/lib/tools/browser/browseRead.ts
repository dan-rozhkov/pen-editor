import type { ToolHandler } from "../../toolRegistry";
import { callBrowserBridge } from "./shared";

/**
 * browse_read — a readable digest of the built-in browser tab's current
 * page: headings, visible text (capped), and links. Added in Addendum 2
 * (docs/superpowers/specs/2026-09-18-browse-task-jev-loop-design.md §2) to
 * give text-shaped tasks something to read — browse_find_images was
 * previously the only tool that read page content at all. Thin forwarder
 * onto the desktop shell's `BrowserController`, same conventions as its
 * browse_* siblings.
 */
export const browseRead: ToolHandler = async (args) => {
  const browser = window.penDesktop?.browser;
  return callBrowserBridge(browser ? (a) => browser.read(a) : undefined, args);
};
