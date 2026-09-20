import type { ToolHandler } from "../../toolRegistry";
import { resolveApiUrl } from "../../apiBase";
import { BROWSER_NOT_AVAILABLE_ERROR } from "./shared";

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

/** The operations `perform` actually accepts (addendum A: WAIT never reaches it). */
type PerformOperation = "CLICK" | "TYPE_TEXT" | "SELECT" | "SCROLL_UP" | "SCROLL_DOWN";

/** Everything a step response's `operation` may name. */
type StepOperation = PerformOperation | "WAIT";

/** Addendum B: the step response's explicit terminal/transient signal. */
type StepOutcome = "act" | "done" | "blocked" | "retry";

interface SnapshotResult {
  url: string;
  title: string;
  elements: unknown[];
  snapshotId: string;
}

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

function isSnapshotResult(value: unknown): value is SnapshotResult {
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
 * snapshot and perform (PR #40's case). Read as a bare success, such a
 * result got recorded as `ok: true` — telling both the transcript and Jev
 * that an action landed when nothing happened at all.
 */
function resultError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const err = (value as { error?: unknown }).error;
  return typeof err === "string" && err !== "" ? err : null;
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
  const res = await fetch(resolveApiUrl("/api/browse/step"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal,
      url: snapshot.url,
      title: snapshot.title,
      elements: snapshot.elements,
      history: history.slice(-HISTORY_LIMIT),
    }),
  });
  if (!res.ok) {
    throw new Error(`/api/browse/step responded ${res.status}`);
  }
  return (await res.json()) as StepResponse;
}

/** Records a step and appends it to the running history in one go. */
function recordStep(
  steps: TranscriptStep[],
  history: StepHistoryEntry[],
  entry: TranscriptStep
): void {
  steps.push(entry);
  history.push({ operation: entry.operation, label: entry.label, ok: entry.ok });
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
  /** recordStep plus the no-progress check. Returns the transcript to
   * return when the loop has stalled, or null to carry on. */
  const note = (entry: TranscriptStep): Transcript | null => {
    recordStep(steps, history, entry);
    if (entry.ok) {
      unproductive = 0;
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

    let snapshot: SnapshotResult;
    try {
      const raw = await browser.snapshot();
      const bridgeError = resultError(raw);
      if (bridgeError) {
        throw new Error(bridgeError);
      }
      if (!isSnapshotResult(raw)) {
        throw new Error("Malformed snapshot result");
      }
      snapshot = raw;
    } catch (err) {
      const stalled = note({
        operation: "SNAPSHOT",
        label: err instanceof Error ? err.message : "snapshot failed",
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }

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

    const isScroll = operation === "SCROLL_UP" || operation === "SCROLL_DOWN";
    const label = labelForElement(snapshot.elements, decision.index);

    // Addendum A / item 3: CLICK/TYPE_TEXT/SELECT require an index; a scroll
    // legitimately carries none. A non-scroll decision arriving without an
    // index is recorded as a failed step rather than forwarded to `perform`.
    if (!isScroll && decision.index == null) {
      const stalled = note({
        operation,
        label: label || "missing index for a non-scroll operation",
        ok: false,
      });
      if (stalled) return stalled;
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
          : { operation, label, ok: true, index: decision.index }
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
