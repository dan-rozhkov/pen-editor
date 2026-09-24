import type { ToolHandler } from "../../toolRegistry";
import {
  attachSnapshot,
  BROWSER_NOT_AVAILABLE_ERROR,
  callBrowserBridge,
  fetchBrowseBackend,
  filterElementsForBackend,
  resultError,
  safeParseObject,
  takeSnapshot,
  type PenDesktopBrowser,
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
  browser: PenDesktopBrowser,
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
      // Scroll-container entries (`ops: []`, `scrollable: true`) fail the
      // backend's non-empty-`ops` schema on a lagging deployment — see
      // filterElementsForBackend's comment.
      elements: filterElementsForBackend(snapshot.elements),
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

/**
 * Runs a single action entry (either a top-level browse_act call or one
 * entry of an `actions` batch) against the bridge — the `element`-vs-index/
 * target routing shared by both. Returns the handler's real JSON string
 * result, same contract as every other browse_* handler.
 */
async function performOne(
  browser: PenDesktopBrowser | undefined,
  entryArgs: Record<string, unknown>
): Promise<string> {
  const { element, ...rest } = entryArgs;
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
}

/**
 * Full browser use follow-up (browse-speed-contract.md, "Frontend" items
 * 1/2): a single browse_act call attaches a fresh `snapshot` when the
 * action changed the page (`changed !== false`), or unconditionally for
 * `wait`/`scroll` (their whole point is to let the page settle/reveal new
 * content, so the model needs a fresh read even when nothing it can see as
 * "changed" fired). A result with no `changed` field at all — including an
 * `{ error }` result — is treated as "may have changed" and still gets a
 * snapshot, erring toward giving the model a fresh read rather than
 * withholding one.
 */
async function maybeAttachSnapshot(
  browser: PenDesktopBrowser | undefined,
  action: string,
  resultObj: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!browser) return resultObj;
  const changed = (resultObj as { changed?: unknown }).changed;
  const shouldAttach = action === "wait" || action === "scroll" || changed !== false;
  if (!shouldAttach) return resultObj;
  return attachSnapshot(browser, resultObj);
}

/**
 * `element` resolution (`resolveByElement`) takes its own fresh snapshot
 * and tells the model to use ITS `resolved.snapshotId` for further
 * index-based calls. But `maybeAttachSnapshot` (above) then very often
 * takes ANOTHER, even fresher snapshot and attaches it as `snapshot` — at
 * that point `resolved.snapshotId` refers to a snapshot one step older
 * than the one just attached, yet `resolved.note` still tells the model to
 * use it. Finding: this handed the model a snapshotId the code itself knew
 * was already stale. When both `resolved` and a freshly-attached `snapshot`
 * are present, drop `resolved.snapshotId` and repoint the note at
 * `snapshot.snapshotId` instead — there is exactly one non-stale snapshotId
 * left in the result, and this makes it the only one the note names.
 */
function reconcileResolvedSnapshot(resultObj: Record<string, unknown>): Record<string, unknown> {
  const snapshot = resultObj.snapshot;
  const resolved = resultObj.resolved;
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    typeof (snapshot as { snapshotId?: unknown }).snapshotId !== "string" ||
    !resolved ||
    typeof resolved !== "object" ||
    Array.isArray(resolved)
  ) {
    return resultObj;
  }
  const freshSnapshotId = (snapshot as { snapshotId: string }).snapshotId;
  const { snapshotId: _staleSnapshotId, ...restResolved } = resolved as Record<string, unknown>;
  return {
    ...resultObj,
    resolved: {
      ...restResolved,
      note: `a newer snapshot was taken after this action settled — use snapshot.snapshotId ("${freshSnapshotId}") for further index-based browse_act calls, not the snapshotId this "resolved" carried`,
    },
  };
}

/** Zod's `actions` array is bounded 1..10 on the backend schema — mirrored
 * here defensively (the args still arrive over the wire from an LLM, not
 * guaranteed to have gone through that schema by the time this handler
 * runs). */
const MAX_BATCH_ACTIONS = 10;

/**
 * browse-speed-contract.md, "Frontend" item 4: the frontend's own
 * browse_act tool-call timeout is 120s (useDesignChat.ts). Without an
 * internal budget, a batch can keep running entries well past that —
 * the caller has already given up and moved on, but the bridge keeps
 * driving the real browser tab underneath it.
 *
 * Finding: 100s left far too little margin. A SINGLE entry's own worst
 * case is ~61.5s (useDesignChat.ts's browse_act comment: 20s snapshot +
 * 20s /api/browse/locate + ~21.5s act-with-cursor-move, for the `element`
 * targeting path) — at 100s, an entry starting as late as t=99s could
 * finish around t=160s, well past the 120s client timeout, with the
 * caller already gone. 60s bounds when a NEW entry may still START, so
 * the worst single already-started entry now finishes around t≈121.5s —
 * comfortably inside the 120s budget for anything but the rare pathological
 * last-entry case, and the final `attachSnapshot` below is skipped once the
 * deadline has passed instead of adding another ~20s on top.
 */
const BATCH_DEADLINE_MS = 60_000;

/** True for a batch entry that resolves `element` itself — the same
 * routing `performOne` uses (an `element` given with neither `index` nor
 * a non-empty `target` goes through `resolveByElement`, which takes its
 * OWN fresh snapshot to match against). Used up front by
 * `findStaleOrderViolation` to reject a batch order that would silently
 * go stale, before running anything. */
function entryReSnapshots(entry: Record<string, unknown>): boolean {
  const hasIndex = entry.index != null;
  const hasTarget = typeof entry.target === "string" && entry.target !== "";
  return isNonEmptyString(entry.element) && !hasIndex && !hasTarget;
}

/**
 * browse-speed-contract.md, "Frontend" item 3: an `element` entry
 * re-snapshots the page (see `entryReSnapshots`), which makes the
 * batch's top-level `snapshotId` — and therefore every INDEX-based entry
 * after it — stale. Rather than silently acting on stale indices (or
 * detecting it only after the fact via a bridge staleness error), reject
 * the whole batch up front with a clear, actionable message. Returns the
 * index of the offending `element` entry, or `undefined` when the order
 * is fine.
 */
function findStaleOrderViolation(actionsRaw: unknown[]): number | undefined {
  let elementEntryIndex: number | undefined;
  for (let i = 0; i < actionsRaw.length; i++) {
    const entry = actionsRaw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const entryObj = entry as Record<string, unknown>;
    if (elementEntryIndex === undefined) {
      if (entryReSnapshots(entryObj)) {
        elementEntryIndex = i;
      }
      continue;
    }
    if (entryObj.index != null) {
      return elementEntryIndex;
    }
  }
  return undefined;
}

/**
 * Runs `actions` sequentially against the bridge, stopping at the first
 * entry that returns `{ error }` or goes stale (browse-speed-contract.md,
 * "Frontend" item 1). Each entry is the same shape as a single browse_act
 * call minus `snapshotId` — index-based entries refer to the TOP-LEVEL
 * `snapshotId` (an entry's own `snapshotId`, if a caller sends one anyway,
 * still wins per-entry). Result shape:
 * `{ results, completed, stoppedAt?, error?, snapshot? }` — `snapshot` is
 * always attempted once at the end, regardless of what the last entry did,
 * since the model needs a fresh read after a whole batch either way.
 *
 * `now` is an injectable seam for the deadline check (item 4) — real time
 * in production, a fake clock in tests exercising that branch without a
 * real 100s wait (same pattern as browseTask.ts's `runBrowseTaskLoop`).
 */
export async function runActionsBatch(
  browser: PenDesktopBrowser | undefined,
  actionsRaw: unknown[],
  topSnapshotId: string | undefined,
  now: () => number = () => Date.now()
): Promise<string> {
  if (actionsRaw.length === 0) {
    return JSON.stringify({ error: "browse_act: \"actions\" must contain at least 1 entry." });
  }
  if (actionsRaw.length > MAX_BATCH_ACTIONS) {
    return JSON.stringify({
      error: `browse_act: "actions" accepts at most ${MAX_BATCH_ACTIONS} entries.`,
    });
  }
  if (!browser) {
    return JSON.stringify({ error: BROWSER_NOT_AVAILABLE_ERROR });
  }

  const staleOrderIndex = findStaleOrderViolation(actionsRaw);
  if (staleOrderIndex != null) {
    return JSON.stringify({
      error:
        `browse_act: actions[${staleOrderIndex}] uses "element", which re-snapshots the page and ` +
        "makes the batch's snapshotId stale for every index-based entry after it — element entries " +
        "re-snapshot the page; put them last or split the batch.",
    });
  }

  const deadline = now() + BATCH_DEADLINE_MS;
  const results: unknown[] = [];
  let completed = 0;
  let stoppedAt: number | undefined;
  let batchError: string | undefined;

  for (let i = 0; i < actionsRaw.length; i++) {
    if (now() >= deadline) {
      batchError = "browse_act: batch deadline reached.";
      stoppedAt = i;
      break;
    }

    const entry = actionsRaw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      batchError = `browse_act: actions[${i}] must be an object.`;
      results.push({ error: batchError });
      stoppedAt = i;
      break;
    }

    const entryArgs: Record<string, unknown> = { ...(entry as Record<string, unknown>) };
    // Finding: the desktop bridge's `act()` treats ANY `snapshotId` on the
    // args as "this is index mode" and rejects an entry with a snapshotId
    // but no `index` (e.g. a targetless `press`/scroll entry). Only copy
    // the batch's top-level snapshotId into entries that actually carry an
    // `index` — a targetless entry must stay snapshotId-free, same as it
    // would be as a standalone browse_act call.
    if (entryArgs.snapshotId == null && topSnapshotId != null && entryArgs.index != null) {
      entryArgs.snapshotId = topSnapshotId;
    }

    const resultStr = await performOne(browser, entryArgs);
    const parsed = safeParseObject(resultStr);
    results.push(parsed);

    const entryError = resultError(parsed);
    if (entryError) {
      batchError = entryError;
      stoppedAt = i;
      break;
    }
    completed++;
  }

  const finalResult: Record<string, unknown> = {
    results,
    completed,
    ...(stoppedAt != null ? { stoppedAt } : {}),
    ...(batchError ? { error: batchError } : {}),
  };

  // Finding: the trailing snapshot is always attempted regardless of how
  // the batch finished — but that costs up to another ~20s of desktop
  // command budget, which is exactly the margin BATCH_DEADLINE_MS above was
  // just tightened to protect. Once the deadline has already passed there
  // is no budget left to spend on it: return the batch result as-is rather
  // than risk pushing the response past browse_act's own client-side
  // tool-call timeout.
  if (now() >= deadline) {
    return JSON.stringify(finalResult);
  }
  return JSON.stringify(await attachSnapshot(browser, finalResult));
}

export const browseAct: ToolHandler = async (args) => {
  const browser = window.penDesktop?.browser;
  const { actions: actionsRaw, ...topLevelRest } = args;

  if (Array.isArray(actionsRaw)) {
    const topSnapshotId =
      typeof topLevelRest.snapshotId === "string" ? topLevelRest.snapshotId : undefined;
    return runActionsBatch(browser, actionsRaw, topSnapshotId);
  }

  const action = typeof args.action === "string" ? args.action : "";
  const resultStr = await performOne(browser, args);
  if (!browser) return resultStr;

  const parsed = safeParseObject(resultStr);
  const withSnapshot = await maybeAttachSnapshot(browser, action, parsed);
  return JSON.stringify(reconcileResolvedSnapshot(withSnapshot));
};
