import {
  attachSnapshot as packageAttachSnapshot,
  callBridge,
  parseResultObject,
  type ExecuteBrowseToolOptions,
} from "@sideform/browser-agent/agent/execute";

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
  "The built-in browser is only available in the Sideform Desktop app.";

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
  "This browser command needs a newer version of the Sideform Desktop app.";

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
  if (!call) return JSON.stringify({ error: unavailableMessage });
  // The package's `callBridge` does the rest: `undefined` becomes `{}` (so the
  // result is always a string) and a throw becomes `{ error }`.
  return callBridge(() => call(args), { texts: peBase.texts });
}

/**
 * The desktop bridge's `browser` surface type, pulled out once so every
 * browse_* module can name it instead of repeating the
 * `NonNullable<NonNullable<typeof window.penDesktop>["browser"]>` spelling.
 */
export type PenDesktopBrowser = NonNullable<NonNullable<typeof window.penDesktop>["browser"]>;

/**
 * Parses a browse_* handler's own JSON-string result back into an object so
 * a caller (browseAct.ts's `actions` batch, the snapshot-attach helpers
 * below) can inspect/merge fields into it. Every browse_* result is
 * produced by `callBrowserBridge`/`resolveByElement`, which always emit a
 * real JSON object string — this only guards the theoretical case where
 * that contract is somehow violated, so it never throws.
 */
export const safeParseObject = parseResultObject;

/**
 * Full browser use follow-up (browse-speed-contract.md, "Frontend" items
 * 1/2): takes a fresh snapshot and merges it into `resultObj` as `snapshot`
 * — the model usually doesn't need a separate browse_snapshot call after an
 * open/act. Best-effort: a failed extra snapshot must not turn an otherwise
 * successful open/act into an error, so this silently returns `resultObj`
 * unchanged when the snapshot itself fails.
 */
export const attachSnapshot = (
  browser: PenDesktopBrowser,
  resultObj: Record<string, unknown>
): Promise<Record<string, unknown>> => packageAttachSnapshot(browser, resultObj);

/**
 * What every browse_* handler passes to the package executor
 * (`@sideform/browser-agent/agent/execute`): this app's own texts for "no
 * bridge", "bridge lacks the method" and "bridge threw a non-Error".
 */
export const peBase: ExecuteBrowseToolOptions = {
  texts: {
    notAvailable: BROWSER_NOT_AVAILABLE_ERROR,
    methodMissing: () => BROWSER_BRIDGE_METHOD_MISSING_ERROR,
    commandFailed: "Built-in browser command failed.",
  },
};
