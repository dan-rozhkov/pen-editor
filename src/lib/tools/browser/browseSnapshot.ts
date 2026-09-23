import type { ToolHandler } from "../../toolRegistry";
import { callBrowserBridge } from "./shared";

/**
 * browse_snapshot — the built-in browser tab's indexed element table,
 * stamped with a `snapshotId` for `browse_act`'s index-targeted actions
 * (click/type/select/hover/press) to act against (docs/superpowers/specs/
 * 2026-09-23-full-browser-use-design.md, "Desktop bridge"). Forwards onto
 * `window.penDesktop.browser.snapshot()`, the same bridge method
 * `browse_task`'s internal loop already uses
 * (docs/superpowers/specs/2026-09-18-browse-task-jev-loop-design.md §1/§3) —
 * this tool just exposes it to the main model directly. Thin forwarder,
 * same conventions as its browse_* siblings.
 */
export const browseSnapshot: ToolHandler = async () => {
  const browser = window.penDesktop?.browser;
  return callBrowserBridge(browser ? () => browser.snapshot() : undefined, {});
};
