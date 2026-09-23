import type { ToolHandler } from "../../toolRegistry";
import {
  BROWSER_NOT_AVAILABLE_ERROR,
  callBrowserBridge,
  fetchBrowseBackend,
  takeSnapshot,
  type SnapshotResult,
} from "./shared";

/**
 * browse_act — drives the built-in browser tab: click/type/scroll/back/
 * forward/press/hover/select/reload/wait. Argument validation (target/text/
 * amount shape per action) lives on the desktop side's `BrowserController`,
 * since these arguments arrive from an LLM through a renderer and that
 * controller is the trust boundary (design doc §3). This handler is mostly
 * a thin forwarder — except for the `text`/`key` presence checks below,
 * which exist purely to avoid wasting a snapshot + /api/browse/locate round
 * trip on an `element` call that the desktop bridge would reject anyway.
 *
 * The one piece of logic that does live here is the optional `element`
 * field (docs/superpowers/specs/2026-09-23-full-browser-use-design.md's
 * follow-up: natural-language element targeting). `target` only matches a
 * CSS selector or exact-ish visible text; `element` lets the model instead
 * describe what it wants ("the search input in the header") and have it
 * resolved to an index against a fresh snapshot by the backend's
 * `/api/browse/locate` (a fast model call, analogous to Jev picking a
 * target for browse_task). `index`/`target` always win when given — this
 * only kicks in when neither is present, so an `element` hint alongside an
 * explicit index/target is silently ignored rather than raced against it.
 */

/**
 * `/api/browse/locate`'s `operation` field reuses browse_task's step
 * vocabulary (CLICK/TYPE_TEXT/SELECT/HOVER/FOCUS) so the backend can share
 * its element-matching prompt with the Jev loop rather than growing a
 * second one. `press` locates as FOCUS, not CLICK: pressing a key can
 * meaningfully target a button, a text input, or a `<select>` alike (FOCUS
 * accepts any of those, see browseLocate.ts's BrowseLocateOperation
 * comment) — CLICK-only candidates could never match a text input, which
 * is exactly where Enter is usually pressed.
 */
const ACTION_TO_LOCATE_OPERATION: Record<string, string> = {
  click: "CLICK",
  type: "TYPE_TEXT",
  select: "SELECT",
  hover: "HOVER",
  press: "FOCUS",
};

/** Actions `/api/browse/locate` can resolve an `element` description for —
 * derived from ACTION_TO_LOCATE_OPERATION's keys rather than a second,
 * separately-maintained list, so the two can't drift (a finding: this used
 * to be a hand-written `Set` next to the map it duplicated). */
const ELEMENT_SUPPORTED_ACTIONS = new Set(Object.keys(ACTION_TO_LOCATE_OPERATION));

interface LocateResponse {
  outcome?: "found" | "not_found" | "retry";
  index?: number;
  label?: string;
  confidence?: number;
  model?: string;
  reason?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Cheap, LOCAL validation of the fields `resolveByElement`'s target action
 * actually needs — checked before taking a snapshot or calling
 * /api/browse/locate at all, so a call missing `text`/`key` fails
 * immediately instead of burning a snapshot + a backend round trip on an
 * action the desktop bridge would reject anyway once it got there. Not a
 * replacement for the bridge's own validation (design doc §3: that's still
 * the trust boundary) — just an early, cheap subset of it for the fields
 * that would otherwise be wasted work to discover are missing.
 */
function validateActionArgs(action: string, rest: Record<string, unknown>): string | null {
  if ((action === "type" || action === "select") && !isNonEmptyString(rest.text)) {
    return `browse_act: action "${action}" requires a non-empty "text" field.`;
  }
  if (action === "press" && !isNonEmptyString(rest.key)) {
    return `browse_act: action "press" requires a non-empty "key" field.`;
  }
  return null;
}

/**
 * Resolves `element` to an index via a fresh snapshot + `/api/browse/locate`,
 * then forwards the original args (minus `element`, plus the resolved
 * `index`/`snapshotId`) to `browser.act`. Every exit path returns a real
 * JSON string, matching every other browse_* handler's contract — a failed
 * resolution is reported as `{ error }` naming what to try instead (target
 * or index) rather than left for the model to guess at.
 */
async function resolveByElement(
  browser: NonNullable<NonNullable<typeof window.penDesktop>["browser"]>,
  action: string,
  element: string,
  rest: Record<string, unknown>
): Promise<string> {
  const snapshotResult = await takeSnapshot(browser);
  if ("error" in snapshotResult) {
    return JSON.stringify({
      error: `browse_act: could not resolve "${element}" — snapshot failed: ${snapshotResult.error}`,
    });
  }
  const snapshot: SnapshotResult = snapshotResult;

  let located: LocateResponse;
  try {
    const res = await fetchBrowseBackend("/api/browse/locate", {
      description: element,
      operation: ACTION_TO_LOCATE_OPERATION[action] ?? "CLICK",
      url: snapshot.url,
      title: snapshot.title,
      elements: snapshot.elements,
    });
    if (res.status === 503) {
      return JSON.stringify({
        error: `browse_act: element targeting is not available (no fast model configured on the backend). Use target or index instead.`,
      });
    }
    if (!res.ok) {
      return JSON.stringify({
        error: `browse_act: /api/browse/locate responded ${res.status} while resolving "${element}". Use target or index instead.`,
      });
    }
    located = (res.body ?? {}) as LocateResponse;
  } catch (err) {
    return JSON.stringify({
      error: `browse_act: /api/browse/locate failed while resolving "${element}" (${
        err instanceof Error ? err.message : String(err)
      }). Use target or index instead.`,
    });
  }

  if (located.outcome === "found" && typeof located.index === "number") {
    const actArgs: Record<string, unknown> = {
      ...rest,
      action,
      index: located.index,
      snapshotId: snapshot.snapshotId,
    };
    delete actArgs.target;

    const result = await callBrowserBridge((a) => browser.act(a), actArgs);
    // Element resolution takes a FRESH snapshot to match against, so this
    // call's snapshotId is now the current one — any snapshotId the model
    // already had (from an earlier browse_snapshot/browse_screenshot/
    // browse_act(element) call) is stale. `resolved` carries the new one
    // plus a note saying so, whether the underlying act itself succeeded
    // or failed, so the model can keep acting by index either way instead
    // of re-deriving it from an error result with nothing to go on.
    const resolved = {
      index: located.index,
      label: located.label,
      confidence: located.confidence,
      snapshotId: snapshot.snapshotId,
      note: "this call took a fresh snapshot to resolve `element` — earlier snapshotIds are now stale; use this snapshotId for further index-based browse_act calls",
    };
    try {
      const parsed: unknown = JSON.parse(result);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return JSON.stringify({ ...parsed, resolved });
      }
    } catch {
      // Not JSON (shouldn't happen — callBrowserBridge always returns a
      // real JSON string) — fall through and hand back the raw result.
    }
    return result;
  }

  if (located.outcome === "not_found") {
    return JSON.stringify({
      error: `No element matched "${element}": ${
        located.reason ?? "not found"
      }. Call browse_snapshot to see the elements and act by index.`,
    });
  }

  // outcome === "retry", or anything else unrecognized — never treated as a
  // silent success (same defensive stance browse_task's step loop takes).
  return JSON.stringify({
    error: `browse_act: could not confidently resolve "${element}" (${
      located.reason ?? "try again or be more specific"
    }). Use target or index instead.`,
  });
}

export const browseAct: ToolHandler = async (args) => {
  const browser = window.penDesktop?.browser;
  const { element, ...rest } = args;

  const hasIndex = rest.index != null;
  const hasTarget = typeof rest.target === "string" && rest.target !== "";

  if (isNonEmptyString(element) && !hasIndex && !hasTarget) {
    const action = typeof rest.action === "string" ? rest.action : "";
    if (!ELEMENT_SUPPORTED_ACTIONS.has(action)) {
      return JSON.stringify({
        error: `browse_act: "element" is only supported for click, type, select, hover, and press actions (got "${action}"). Use target or index instead.`,
      });
    }
    // Cheap field checks BEFORE the snapshot/locate round trip — see
    // validateActionArgs's own comment.
    const validationError = validateActionArgs(action, rest);
    if (validationError) {
      return JSON.stringify({ error: validationError });
    }
    if (!browser) {
      return JSON.stringify({ error: BROWSER_NOT_AVAILABLE_ERROR });
    }
    return resolveByElement(browser, action, element, rest);
  }

  // `element` given alongside index/target, or not given at all: index wins
  // over target per browse_act's existing contract, and `element` (if any)
  // is dropped rather than forwarded — the bridge doesn't know that field.
  return callBrowserBridge(browser ? (a) => browser.act(a) : undefined, rest);
};
