import { resolveApiUrl } from "../../apiBase";

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

/**
 * The shape `window.penDesktop.browser.snapshot()` resolves with on success
 * (docs/superpowers/specs/2026-09-18-browse-task-jev-loop-design.md §1).
 * Shared between browseTask.ts (the Jev loop) and browseAct.ts (the
 * `element` natural-language targeting path, docs/superpowers/specs/
 * 2026-09-23-full-browser-use-design.md) — both need to take a snapshot and
 * validate its shape before acting on it by index.
 */
export interface SnapshotResult {
  url: string;
  title: string;
  elements: unknown[];
  snapshotId: string;
  /**
   * Full browser use follow-up (browse-speed-contract.md 2026-09-24,
   * "Frontend" item 4 / "Backend" item 5): the page's scroll position.
   * Forwarded untouched by browseTask.ts's `requestStep` to
   * `/api/browse/step` so Jev's digest can mention it — this side never
   * inspects the shape, only passes it through.
   */
  scroll?: unknown;
  /** Present when the element table was capped — passed through untouched,
   * same as `scroll`. */
  truncated?: boolean;
}

/**
 * The desktop bridge's `browser` surface type, pulled out once so every
 * browse_* module can name it instead of repeating the
 * `NonNullable<NonNullable<typeof window.penDesktop>["browser"]>` spelling.
 */
export type PenDesktopBrowser = NonNullable<NonNullable<typeof window.penDesktop>["browser"]>;

export function isSnapshotResult(value: unknown): value is SnapshotResult {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as SnapshotResult).url === "string" &&
    typeof (value as SnapshotResult).title === "string" &&
    Array.isArray((value as SnapshotResult).elements) &&
    typeof (value as SnapshotResult).snapshotId === "string"
  );
}

/**
 * The desktop bridge never rejects: `window.penDesktop.browser.*` resolves
 * with `{ error: "..." }` for every refusal the controller makes, including
 * the stale-snapshotId guard that fires when the page re-rendered between
 * snapshot and perform/act. Read as a bare success, such a result would be
 * recorded as ok — telling a caller an action landed when nothing happened
 * at all. Shared between browseTask.ts and browseAct.ts for the same reason
 * as `isSnapshotResult` above.
 */
export function resultError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const err = (value as { error?: unknown }).error;
  return typeof err === "string" && err !== "" ? err : null;
}

/**
 * Takes a fresh snapshot and validates its shape/checks for a bridge
 * refusal, returning either a real `SnapshotResult` or `{ error }` — never
 * throws. Shared by browseTask.ts's loop and browseAct.ts's `element`
 * resolution path, which each used to hand-roll the identical
 * try/snapshot/resultError/isSnapshotResult sequence (finding: the two
 * copies had already started to drift in what they returned on a malformed
 * result). Callers still own how they PHRASE the failure to the model —
 * browseTask records it as a step, browseAct wraps it with "could not
 * resolve \"...\"" — this only owns the snapshot-taking and validation
 * itself.
 */
export async function takeSnapshot(
  browser: NonNullable<NonNullable<typeof window.penDesktop>["browser"]>
): Promise<SnapshotResult | { error: string }> {
  try {
    const raw = await browser.snapshot();
    const bridgeError = resultError(raw);
    if (bridgeError) {
      return { error: bridgeError };
    }
    if (!isSnapshotResult(raw)) {
      return { error: "Malformed snapshot result" };
    }
    return raw;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Parses a browse_* handler's own JSON-string result back into an object so
 * a caller (browseAct.ts's `actions` batch, the snapshot-attach helpers
 * below) can inspect/merge fields into it. Every browse_* result is
 * produced by `callBrowserBridge`/`resolveByElement`, which always emit a
 * real JSON object string — this only guards the theoretical case where
 * that contract is somehow violated, so it never throws.
 */
export function safeParseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return { error: "browse_act: malformed result from the browser bridge." };
}

/**
 * Full browser use follow-up (browse-speed-contract.md, "Frontend" items
 * 1/2): takes a fresh snapshot and merges it into `resultObj` as `snapshot`
 * — the model usually doesn't need a separate browse_snapshot call after an
 * open/act. Best-effort: a failed extra snapshot must not turn an otherwise
 * successful open/act into an error, so this silently returns `resultObj`
 * unchanged when the snapshot itself fails.
 */
export async function attachSnapshot(
  browser: PenDesktopBrowser,
  resultObj: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const snap = await takeSnapshot(browser);
  if ("error" in snap) return resultObj;
  return { ...resultObj, snapshot: snap };
}

/**
 * The desktop snapshot now also emits scroll-container entries shaped
 * `{index, tag, label, ops: [], scrollable: true}` (so the agent can scroll
 * inside modals/lists by index). `/api/browse/step`'s and
 * `/api/browse/locate`'s zod schemas require a non-empty `ops` array per
 * element, so forwarding a scroll-container entry verbatim would 400 the
 * request on any page that has one — this is defense in depth alongside the
 * backend's own carve-out for `scrollable` elements (the deployed backend
 * may lag the client that just started sending these). Every `/api/browse/*`
 * forwarding site filters its `elements` payload through this before
 * POSTing.
 */
export function filterElementsForBackend(elements: unknown[]): unknown[] {
  return elements.filter((el) => {
    if (!el || typeof el !== "object") return true;
    const ops = (el as { ops?: unknown }).ops;
    return Array.isArray(ops) && ops.length > 0;
  });
}

/**
 * How long a request to a `/api/browse/*` backend route (Jev's `step`
 * decision, or the `element` natural-language `locate` lookup) is allowed to
 * run before this client gives up on it. Both routes call a fast model with
 * a short prompt — 20s is generous headroom over their expected latency
 * without eating too far into the calling tool's own
 * TOOL_CALL_TIMEOUT_MS_OVERRIDES budget (useDesignChat.ts).
 */
const BROWSE_BACKEND_REQUEST_TIMEOUT_MS = 20_000;

/**
 * `fetchBrowseBackend`'s result: the parsed body alongside `status`/`ok` —
 * callers still own status-code and JSON-shape handling (browse/step's
 * "any non-ok status is a hard failure" differs from browse/locate's "503
 * means no fast model configured, everything else is a retry-and-fall-back
 * signal"). `body` is `null` when the response wasn't valid JSON (an error
 * page from a proxy in front of the backend, say) — callers already treat
 * a response they can't make sense of as a failure, so this is reported
 * the same way a missing/unrecognized field would be, not as a thrown
 * error.
 */
export interface BrowseBackendResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

/**
 * POSTs `body` to a `/api/browse/*` backend route and returns its parsed
 * result. Centralizes what's genuinely identical between the two `/api/
 * browse/*` routes: the backend base URL (via `resolveApiUrl`, the same one
 * every other backend caller in this project uses), the JSON content-type
 * header, and an abort timeout so a hung backend fails fast instead of
 * riding out the calling tool's whole timeout budget in silence.
 *
 * The timeout bounds `res.json()` too, not just the fetch — it used to only
 * wrap the `fetch()` call, clearing the abort timer as soon as headers
 * arrived; a backend that sent headers promptly but then stalled writing
 * (or streamed) the body could hang `res.json()` indefinitely with no
 * timeout protecting it at all. Doing the parse here, inside the same
 * try/finally, means BROWSE_BACKEND_REQUEST_TIMEOUT_MS now bounds the
 * WHOLE round trip — connect through body-read — for both callers, with no
 * separate timeout needed on their end.
 */
export async function fetchBrowseBackend(
  path: string,
  body: Record<string, unknown>
): Promise<BrowseBackendResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BROWSE_BACKEND_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(resolveApiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let parsedBody: unknown = null;
    try {
      parsedBody = await res.json();
    } catch {
      // Non-JSON body — report as `null` rather than throwing, same as an
      // unrecognized/missing field elsewhere on these responses.
      parsedBody = null;
    }
    return { status: res.status, ok: res.ok, body: parsedBody };
  } finally {
    clearTimeout(timer);
  }
}
