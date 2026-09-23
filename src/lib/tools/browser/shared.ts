/**
 * Shared plumbing for the browse_* forwarding tools (browse_open, browse_act,
 * browse_find_images, browse_read — docs/superpowers/specs/
 * 2026-09-18-builtin-browser-design.md §4/§6 and the browse_read addendum in
 * 2026-09-18-browse-task-jev-loop-design.md). All are client-executed, thin
 * forwarders onto
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
 * `window.penDesktop.browser` exists (an older desktop build is running) but
 * the specific method a tool needs (`screenshot`/`tabs`, added in
 * docs/superpowers/specs/2026-09-23-full-browser-use-design.md) is not on
 * it. Distinct from `BROWSER_NOT_AVAILABLE_ERROR` — that one means "no
 * built-in browser at all" (web build, or no desktop shell), this one means
 * "there is a browser, but this command is newer than it" — so the model
 * gets an actionable message instead of a generic "not available" that
 * would suggest retrying is pointless for the wrong reason.
 */
export const BROWSER_BRIDGE_METHOD_MISSING_ERROR =
  "This browser command needs a newer version of the Pineapple Editor desktop app.";

/**
 * Runs `call` against the desktop's browser bridge and stringifies the
 * result. Never throws: a missing bridge or a rejecting preload call both
 * come back as a JSON `{"error": "..."}` string, the same shape every other
 * tool handler in this project uses to report failure.
 *
 * `unavailableMessage` lets a caller substitute
 * `BROWSER_BRIDGE_METHOD_MISSING_ERROR` for the default when `call` is
 * `undefined` because the bridge exists but lacks this particular method,
 * rather than because the bridge is absent entirely.
 */
export async function callBrowserBridge(
  call: ((args: Record<string, unknown>) => Promise<unknown>) | undefined,
  args: Record<string, unknown>,
  unavailableMessage: string = BROWSER_NOT_AVAILABLE_ERROR
): Promise<string> {
  if (!call) {
    return JSON.stringify({ error: unavailableMessage });
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
