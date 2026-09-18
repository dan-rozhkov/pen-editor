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
  status: "done" | "blocked" | "budget";
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

  for (let stepCount = 0; stepCount < cappedMaxSteps; stepCount++) {
    if (now() >= deadline) {
      return { status: "budget", steps, url: lastUrl, title: lastTitle, reason: "deadline exceeded" };
    }

    let snapshot: SnapshotResult;
    try {
      const raw = await browser.snapshot();
      if (!isSnapshotResult(raw)) {
        throw new Error("Malformed snapshot result");
      }
      snapshot = raw;
    } catch (err) {
      recordStep(steps, history, {
        operation: "SNAPSHOT",
        label: err instanceof Error ? err.message : "snapshot failed",
        ok: false,
      });
      continue;
    }

    lastUrl = snapshot.url;
    lastTitle = snapshot.title;

    let decision: StepResponse;
    try {
      decision = await requestStep(goal, snapshot, history);
    } catch (err) {
      recordStep(steps, history, {
        operation: "STEP",
        label: err instanceof Error ? err.message : "/api/browse/step failed",
        ok: false,
      });
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
      recordStep(steps, history, {
        operation: decision.operation ?? "RETRY",
        label: decision.reason ?? "transient step failure, retrying",
        ok: false,
      });
      continue;
    }
    if (decision.outcome !== "act") {
      recordStep(steps, history, {
        operation: decision.operation ?? "UNKNOWN_OUTCOME",
        label: decision.reason ?? `unrecognized step outcome: ${String(decision.outcome)}`,
        ok: false,
      });
      continue;
    }

    // outcome === "act" from here on.
    if (decision.operation === "WAIT") {
      // Addendum A: WAIT never reaches `perform` — the loop sleeps itself
      // and takes a fresh snapshot on the next iteration.
      recordStep(steps, history, { operation: "WAIT", label: "waiting for the page to settle", ok: true });
      await sleep(WAIT_SLEEP_MS);
      continue;
    }

    const operation = decision.operation;
    if (!operation) {
      recordStep(steps, history, {
        operation: "MALFORMED",
        label: decision.reason ?? "act outcome with no operation",
        ok: false,
      });
      continue;
    }

    const isScroll = operation === "SCROLL_UP" || operation === "SCROLL_DOWN";
    const label = labelForElement(snapshot.elements, decision.index);

    // Addendum A / item 3: CLICK/TYPE_TEXT/SELECT require an index; a scroll
    // legitimately carries none. A non-scroll decision arriving without an
    // index is recorded as a failed step rather than forwarded to `perform`.
    if (!isScroll && decision.index == null) {
      recordStep(steps, history, {
        operation,
        label: label || "missing index for a non-scroll operation",
        ok: false,
      });
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
      await browser.perform(performArgs);
      recordStep(steps, history, { operation, label, ok: true, index: decision.index });
    } catch (err) {
      // A failing step (design doc §3/§4: "a failing step is recorded and
      // does not abort the whole task") is recorded in the transcript and
      // the loop continues — only a done/blocked outcome, maxSteps or the
      // deadline end the task.
      recordStep(steps, history, {
        operation,
        label: err instanceof Error ? err.message : "perform failed",
        ok: false,
        index: decision.index,
      });
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
