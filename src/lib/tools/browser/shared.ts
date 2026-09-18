/**
 * Shared plumbing for the three browse_* tools (browse_open, browse_act,
 * browse_find_images — docs/superpowers/specs/2026-09-18-builtin-browser-design.md
 * §4/§6). All three are client-executed, thin forwarders onto
 * `window.penDesktop.browser.*` (the preload surface described in §5): the
 * real work happens in the Electron main process's `BrowserController`.
 *
 * Outside the desktop shell `window.penDesktop.browser` is undefined (web
 * builds, and desktop builds older than this feature), so every handler
 * must degrade to a documented error string rather than throw — matching
 * every other ToolHandler's "always resolves" contract.
 */
export const BROWSER_NOT_AVAILABLE_ERROR =
  "The built-in browser is only available in the Pineapple Editor desktop app.";

/**
 * Runs `call` against the desktop's browser bridge and stringifies the
 * result. Never throws: a missing bridge or a rejecting preload call both
 * come back as a JSON `{"error": "..."}` string, the same shape every other
 * tool handler in this project uses to report failure.
 */
export async function callBrowserBridge(
  call: ((args: Record<string, unknown>) => Promise<unknown>) | undefined,
  args: Record<string, unknown>
): Promise<string> {
  if (!call) {
    return JSON.stringify({ error: BROWSER_NOT_AVAILABLE_ERROR });
  }
  try {
    const result = await call(args);
    // `call`'s declared return type is `Promise<unknown>`, which permits
    // `undefined` — JSON.stringify(undefined) yields the value `undefined`,
    // not a string, violating ToolHandler's `Promise<string>` contract.
    // `executeToolCall` then calls `result.startsWith('{"error"')` on that
    // non-string and throws a TypeError, surfacing a bogus error to the
    // model instead of the (empty) result. Coalesce to `{}` so this always
    // returns a real JSON string.
    return JSON.stringify(result ?? {});
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : "Built-in browser command failed.",
    });
  }
}
