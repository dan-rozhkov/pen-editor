import type { ToolHandler } from "../../toolRegistry";
import {
  BROWSER_NOT_AVAILABLE_ERROR,
  fetchBrowseBackend,
  resultError,
  takeSnapshot,
  type SnapshotResult,
} from "./shared";

/**
 * browse_task — a Jev-driven browsing loop
 * (docs/superpowers/specs/2026-09-18-browse-task-jev-loop-design.md §3, as
 * corrected by the "Addendum, 2026-09-18: contract corrections after
 * review" at the end of that doc). Unlike browse_open/browse_act/
 * browse_find_images, this handler does not just forward one call to the
 * desktop bridge: it *is* the loop. Per cycle it takes a fresh
 * element-table snapshot from the page (`window.penDesktop.browser.snapshot()`),
 * POSTs it plus a short history to the backend's `/api/browse/step`
 * (stateless — Jev picks the next operation/target), and applies the
 * decision with `window.penDesktop.browser.perform(...)`. It repeats until
 * the backend answers `outcome: "done"` or `"blocked"`, or the budget
 * (`maxSteps`/deadline) runs out.
 *
 * One chat tool call therefore drives a whole multi-step task without the
 * design model in the loop at all — see the design doc's "Where the loop
 * runs" section for why this lives here rather than on the backend.
 */

/** design doc §3: "maxSteps default 12, hard cap 25". */
const DEFAULT_MAX_STEPS = 12;
const HARD_MAX_STEPS = 25;

/** design doc §3: BROWSE_TASK_DEADLINE_MS = 90_000. */
const BROWSE_TASK_DEADLINE_MS = 90_000;

/** design doc §3: "keeping a short history" / backend request shape: last 10 steps. */
const HISTORY_LIMIT = 10;

/**
 * Upstream jev-ultrafast PR #40 ("record stale executions so undecidable
 * stale loops can stop"), ported: how many consecutive steps may land
 * nothing before the loop gives up. A target that is persistently stale
 * between the snapshot and the act (a live-updating popover, a list that
 * re-renders on a timer) otherwise loops snapshot → step → rejected act
 * until maxSteps runs out, spending a paid Jev call per cycle without a
 * single executed action. Any step that lands — including a WAIT, which is
 * a deliberate decision, not a failure — resets the count.
 */
const MAX_CONSECUTIVE_UNPRODUCTIVE_STEPS = 3;

/**
 * Addendum A: "the loop sleeps ~400 ms itself, takes a fresh snapshot and
 * continues" when the decision is WAIT.
 */
const WAIT_SLEEP_MS = 400;

/**
 * pen-editor-backend/src/routes/browseStep.ts's `historyEntrySchema` caps
 * `label` at 200 chars (`label: z.string().max(200)`) — every step this
 * loop records is appended to `history` and sent right back up on the
 * NEXT /api/browse/step call, so a label over that limit 400s that next
 * request and silently stalls the whole task (the loop's own error
 * handling treats a non-ok response as a thrown error, so this looked like
 * "the backend broke" rather than "our own label was too long"). The two
 * repos don't share code, so this is a plain mirrored constant, not an
 * import — keep it in sync with the backend schema if that cap ever moves.
 */
const HISTORY_LABEL_MAX_CHARS = 200;

/**
 * Per-fragment cap for a side-effect description folded into a step label
 * (an opened tab's title, an auto-handled dialog's message — both are
 * page-derived text with no length guarantee of their own). Generous
 * enough to stay informative while leaving room for the base label plus
 * whichever OTHER side-effect fragment rides along, so two long fragments
 * together still can't blow past HISTORY_LABEL_MAX_CHARS on their own —
 * recordStep's hard truncation is the final backstop regardless.
 */
const SIDE_EFFECT_FRAGMENT_MAX_CHARS = 60;

/** Truncates `value` to at most `max` characters, replacing anything cut
 * with a single ellipsis character so the cap is still exactly `max`. */
function truncateToChars(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** The operations `perform` actually accepts (addendum A: WAIT never reaches it). */
type PerformOperation = "CLICK" | "TYPE_TEXT" | "SELECT" | "SCROLL_UP" | "SCROLL_DOWN";

/**
 * The operations dispatched through `browser.act` instead of `browser.perform`
 * (docs/superpowers/specs/2026-09-23-full-browser-use-design.md, "act gains
 * actions and index targeting"). PRESS_ENTER/PRESS_ESCAPE act on whatever
 * currently has focus — right after TYPE_TEXT that's the field just typed
 * into — and carry no index; HOVER targets an element by index like CLICK
 * does.
 */
type ActOperation = "PRESS_ENTER" | "PRESS_ESCAPE" | "HOVER";

/** Everything a step response's `operation` may name. */
type StepOperation = PerformOperation | ActOperation | "WAIT";

/** Addendum B: the step response's explicit terminal/transient signal. */
type StepOutcome = "act" | "done" | "blocked" | "retry";

interface StepHistoryEntry {
  operation: string;
  label: string;
  ok: boolean;
}

interface StepResponse {
  /**
   * Addendum B. Optional in the type only because we must treat a
   * missing/unrecognized value defensively at runtime, the same as an
   * explicit "retry" — never as success.
   */
  outcome?: StepOutcome;
  /** Present for `outcome: "act"`; absent for done/blocked/retry. */
  operation?: StepOperation;
  index?: number;
  text?: string;
  confidence: number;
  model: string;
  reason?: string;
}

interface TranscriptStep extends StepHistoryEntry {
  index?: number;
}

interface Transcript {
  status: "done" | "blocked" | "budget" | "stalled";
  steps: TranscriptStep[];
  url: string;
  title: string;
  reason?: string;
}

function labelForElement(elements: unknown[], index: number | undefined): string {
  if (index == null) return "";
  const el = elements[index] as { label?: unknown } | undefined;
  return el && typeof el.label === "string" ? el.label : "";
}

async function requestStep(
  goal: string,
  snapshot: SnapshotResult,
  history: StepHistoryEntry[]
): Promise<StepResponse> {
  const res = await fetchBrowseBackend("/api/browse/step", {
    goal,
    url: snapshot.url,
    title: snapshot.title,
    elements: snapshot.elements,
    history: history.slice(-HISTORY_LIMIT),
  });
  if (!res.ok) {
    throw new Error(`/api/browse/step responded ${res.status}`);
  }
  return res.body as StepResponse;
}

/**
 * `openedTab`/`dialogs` (docs/superpowers/specs/
 * 2026-09-23-full-browser-use-design.md, "Desktop bridge") can ride along on
 * any `act`/`perform` result. Folded into the step's label (and therefore
 * into both the transcript and the history Jev sees on the next request) so
 * a tab switch or an auto-handled JS dialog isn't silently invisible to the
 * next decision — Jev needs to know the page it's driving just changed out
 * from under it.
 */
function describeSideEffects(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const parts: string[] = [];

  const openedTab = (value as { openedTab?: unknown }).openedTab;
  if (openedTab && typeof openedTab === "object") {
    const title = (openedTab as { title?: unknown }).title;
    const url = (openedTab as { url?: unknown }).url;
    const name =
      typeof title === "string" && title ? title : typeof url === "string" ? url : "new tab";
    parts.push(`→ opened tab: ${truncateToChars(name, SIDE_EFFECT_FRAGMENT_MAX_CHARS)}`);
  }

  const dialogs = (value as { dialogs?: unknown }).dialogs;
  if (Array.isArray(dialogs) && dialogs.length > 0) {
    const summary = dialogs
      .map((d: unknown) => {
        const type = d && typeof d === "object" && typeof (d as { type?: unknown }).type === "string"
          ? (d as { type: string }).type
          : "dialog";
        const message =
          d && typeof d === "object" && typeof (d as { message?: unknown }).message === "string"
            ? truncateToChars((d as { message: string }).message, SIDE_EFFECT_FRAGMENT_MAX_CHARS)
            : "";
        return message ? `${type}: ${message}` : type;
      })
      .join("; ");
    parts.push(`(dialog auto-handled: ${summary})`);
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/** True when a `browser.act` result explicitly reports `changed: false` —
 * the action ran (no `{ error }`) but altered nothing. See its call site's
 * comment for why that must count as an unproductive step for stall
 * detection, same as a rejected act. A result with no `changed` field at
 * all (a bridge that predates the `{ changed, changes }` diff, or a result
 * shape that doesn't carry it) is NOT treated as no-effect — only an
 * explicit `false` is, so this stays a strict tightening rather than a
 * behavior change for bridges that don't report it. */
function isNoEffectResult(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as { changed?: unknown }).changed === false;
}

/**
 * Records a step and appends it to the running history in one go —
 * hard-truncating `label` to HISTORY_LABEL_MAX_CHARS first. This is the
 * backstop, not describeSideEffects' per-fragment truncation above: the
 * BASE label (an element's own text, or an error message from the bridge/
 * backend) has no length guarantee either, so the cap has to apply here,
 * after everything is concatenated, not just to the side-effect fragments.
 */
function recordStep(
  steps: TranscriptStep[],
  history: StepHistoryEntry[],
  entry: TranscriptStep
): void {
  const truncated: TranscriptStep = {
    ...entry,
    label: truncateToChars(entry.label, HISTORY_LABEL_MAX_CHARS),
  };
  steps.push(truncated);
  history.push({ operation: truncated.operation, label: truncated.label, ok: truncated.ok });
}

/**
 * Runs the snapshot → step → perform loop. Exported separately from the
 * `ToolHandler` wrapper so tests can drive it directly and so the deadline
 * check and the WAIT sleep each have a single injectable seam — real time
 * (`Date.now`) and a real `setTimeout` in production, a fake clock and an
 * instrumented no-op sleep in tests exercising those branches without a
 * real wait.
 */
export async function runBrowseTaskLoop(
  goal: string,
  maxSteps: number,
  browser: NonNullable<NonNullable<typeof window.penDesktop>["browser"]>,
  now: () => number = () => Date.now(),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<Transcript> {
  const cappedMaxSteps = Math.min(Math.max(1, Math.floor(maxSteps)), HARD_MAX_STEPS);
  const deadline = now() + BROWSE_TASK_DEADLINE_MS;
  const steps: TranscriptStep[] = [];
  const history: StepHistoryEntry[] = [];

  let lastUrl = "";
  let lastTitle = "";

  // PR #40: a step that landed nothing is still recorded (Jev needs to see
  // the no-op in `history`, or it re-picks the same dead target), but three
  // in a row end the task instead of grinding out the whole budget.
  let unproductive = 0;
  /** The most recent SUCCESSFULLY landed step's `operation` — used to gate
   * PRESS_ENTER (see its dispatch below: Enter is only pressed right after
   * a TYPE_TEXT that landed, since a perform CLICK never moves focus, and a
   * WAIT/SCROLL in between means Enter would submit whatever the page
   * happens to have focus on, not the field Jev meant). `null` until the
   * first step lands. */
  let lastLandedOperation: string | null = null;
  /** recordStep plus the no-progress check. Returns the transcript to
   * return when the loop has stalled, or null to carry on. */
  const note = (entry: TranscriptStep): Transcript | null => {
    recordStep(steps, history, entry);
    if (entry.ok) {
      unproductive = 0;
      lastLandedOperation = entry.operation;
      return null;
    }
    unproductive++;
    if (unproductive < MAX_CONSECUTIVE_UNPRODUCTIVE_STEPS) return null;
    return {
      status: "stalled",
      steps,
      url: lastUrl,
      title: lastTitle,
      reason: `no progress — ${MAX_CONSECUTIVE_UNPRODUCTIVE_STEPS} consecutive steps landed nothing (last: ${entry.operation}: ${entry.label})`,
    };
  };

  for (let stepCount = 0; stepCount < cappedMaxSteps; stepCount++) {
    if (now() >= deadline) {
      return { status: "budget", steps, url: lastUrl, title: lastTitle, reason: "deadline exceeded" };
    }

    const snapshotResult = await takeSnapshot(browser);
    if ("error" in snapshotResult) {
      const stalled = note({
        operation: "SNAPSHOT",
        label: snapshotResult.error,
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }
    const snapshot: SnapshotResult = snapshotResult;

    lastUrl = snapshot.url;
    lastTitle = snapshot.title;

    let decision: StepResponse;
    try {
      decision = await requestStep(goal, snapshot, history);
    } catch (err) {
      const stalled = note({
        operation: "STEP",
        label: err instanceof Error ? err.message : "/api/browse/step failed",
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }

    // Addendum B: outcome is the explicit terminal/transient signal. `done`
    // and `blocked` end the task; `retry` (Jev timeout/malformed answer/no
    // candidate element) and anything unrecognized or missing are recorded
    // and the loop continues — treating an unknown outcome as a silent
    // success would be exactly the bug the addendum corrects.
    if (decision.outcome === "done") {
      return { status: "done", steps, url: lastUrl, title: lastTitle, reason: decision.reason };
    }
    if (decision.outcome === "blocked") {
      return { status: "blocked", steps, url: lastUrl, title: lastTitle, reason: decision.reason };
    }
    if (decision.outcome === "retry") {
      const stalled = note({
        operation: decision.operation ?? "RETRY",
        label: decision.reason ?? "transient step failure, retrying",
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }
    if (decision.outcome !== "act") {
      const stalled = note({
        operation: decision.operation ?? "UNKNOWN_OUTCOME",
        label: decision.reason ?? `unrecognized step outcome: ${String(decision.outcome)}`,
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }

    // outcome === "act" from here on.
    if (decision.operation === "WAIT") {
      // Addendum A: WAIT never reaches `perform` — the loop sleeps itself
      // and takes a fresh snapshot on the next iteration.
      note({ operation: "WAIT", label: "waiting for the page to settle", ok: true });
      await sleep(WAIT_SLEEP_MS);
      continue;
    }

    const operation = decision.operation;
    if (!operation) {
      const stalled = note({
        operation: "MALFORMED",
        label: decision.reason ?? "act outcome with no operation",
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }

    // Full browser use (docs/superpowers/specs/
    // 2026-09-23-full-browser-use-design.md): PRESS_ENTER/PRESS_ESCAPE are
    // targetless (they act on whatever already has focus — right after
    // TYPE_TEXT that's the field just typed into), same as a scroll. HOVER
    // targets an element by index, same as CLICK.
    const isTargetless =
      operation === "SCROLL_UP" ||
      operation === "SCROLL_DOWN" ||
      operation === "PRESS_ENTER" ||
      operation === "PRESS_ESCAPE";
    const label = labelForElement(snapshot.elements, decision.index);

    // Addendum A / item 3: CLICK/TYPE_TEXT/SELECT/HOVER require an index; a
    // scroll or a targetless press legitimately carries none. A non-scroll,
    // non-targetless decision arriving without an index is recorded as a
    // failed step rather than forwarded to `perform`/`act`.
    if (!isTargetless && decision.index == null) {
      const stalled = note({
        operation,
        label: label || "missing index for a non-scroll operation",
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }

    if (operation === "PRESS_ENTER" || operation === "PRESS_ESCAPE" || operation === "HOVER") {
      // Full browser use follow-up (finding: Enter is only meaningful right
      // after typing into a field). The backend already refuses PRESS_ENTER
      // when a password field is anywhere on the page, but it has no way to
      // know WHICH element currently has focus — that's client-side state.
      // A perform CLICK never moves focus, so the only step that reliably
      // leaves the right field focused is a just-landed TYPE_TEXT; anything
      // else (including a WAIT/SCROLL taken in between) means Enter would
      // submit whatever the page happens to have focus on, not the field
      // Jev meant. Refused without ever calling the bridge — recorded as a
      // failed (not stale-target) step so Jev sees why and picks something
      // else next cycle.
      if (operation === "PRESS_ENTER" && lastLandedOperation !== "TYPE_TEXT") {
        const stalled = note({
          operation,
          label: "Enter is only pressed right after typing into a field",
          ok: false,
          index: decision.index,
        });
        if (stalled) return stalled;
        continue;
      }

      const actArgs: Record<string, unknown> =
        operation === "HOVER"
          ? { action: "hover", index: decision.index, snapshotId: snapshot.snapshotId }
          : { action: "press", key: operation === "PRESS_ENTER" ? "Enter" : "Escape" };
      const actLabel =
        operation === "HOVER" ? label : operation === "PRESS_ENTER" ? "press Enter" : "press Escape";

      try {
        const acted = await browser.act(actArgs);
        // Same PR #40 contract as `perform`: the bridge resolves `{ error }`
        // rather than rejecting.
        const rejected = resultError(acted);
        // Finding: a `changed: false` result (see the desktop bridge's
        // `{ changed, changes }` diff) landed with no error but altered
        // nothing — e.g. Escape with nothing open to close, or hovering an
        // element that has no hover-revealed state. That is exactly the
        // "no progress" case the consecutive-unproductive-steps counter
        // exists to catch, so it must count the same way a rejected act
        // does, not as a landed action.
        const noEffect = !rejected && isNoEffectResult(acted);
        const stalled = note(
          rejected
            ? { operation, label: rejected, ok: false, index: decision.index }
            : {
                operation,
                label: `${actLabel}${describeSideEffects(acted)}`,
                ok: !noEffect,
                index: decision.index,
              }
        );
        if (stalled) return stalled;
      } catch (err) {
        const stalled = note({
          operation,
          label: err instanceof Error ? err.message : "act failed",
          ok: false,
          index: decision.index,
        });
        if (stalled) return stalled;
      }
      continue;
    }

    const performArgs: {
      snapshotId: string;
      index?: number;
      operation: PerformOperation;
      text?: string;
    } = {
      snapshotId: snapshot.snapshotId,
      operation,
      text: decision.text,
    };
    // Only forward `index` when it is genuinely present — never
    // `index: undefined` for a scroll, per addendum A.
    if (decision.index != null) {
      performArgs.index = decision.index;
    }

    try {
      const performed = await browser.perform(performArgs);
      // PR #40: `perform` resolves with `{ error }` rather than rejecting
      // (see resultError) — a stale snapshotId, a target that is gone or
      // occluded. Recording that as a landed action is what let a
      // persistently stale target loop forever while the transcript
      // claimed success on every cycle.
      const rejected = resultError(performed);
      const stalled = note(
        rejected
          ? { operation, label: rejected, ok: false, index: decision.index }
          : { operation, label: `${label}${describeSideEffects(performed)}`, ok: true, index: decision.index }
      );
      if (stalled) return stalled;
    } catch (err) {
      // A failing step (design doc §3/§4: "a failing step is recorded and
      // does not abort the whole task") is recorded in the transcript and
      // the loop continues — only a done/blocked outcome, the no-progress
      // check, maxSteps or the deadline end the task.
      const stalled = note({
        operation,
        label: err instanceof Error ? err.message : "perform failed",
        ok: false,
        index: decision.index,
      });
      if (stalled) return stalled;
    }
  }

  return { status: "budget", steps, url: lastUrl, title: lastTitle, reason: "maxSteps reached" };
}

export const browseTask: ToolHandler = async (args) => {
  const browser = window.penDesktop?.browser;
  if (!browser) {
    return JSON.stringify({ error: BROWSER_NOT_AVAILABLE_ERROR });
  }

  const goal = typeof args.goal === "string" ? args.goal : "";
  const maxSteps =
    typeof args.maxSteps === "number" && Number.isFinite(args.maxSteps)
      ? args.maxSteps
      : DEFAULT_MAX_STEPS;

  try {
    const transcript = await runBrowseTaskLoop(goal, maxSteps, browser);
    // Matches every other browser tool handler's "always resolves a real
    // JSON string" contract (see shared.ts's callBrowserBridge comment) —
    // this handler doesn't route through callBrowserBridge since it makes
    // many bridge/network calls rather than one, but the guarantee is the
    // same.
    return JSON.stringify(transcript ?? {});
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : "browse_task failed.",
    });
  }
};
