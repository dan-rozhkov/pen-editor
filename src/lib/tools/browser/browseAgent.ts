import { resetLoopGuard } from "@sideform/browser-agent/loop";
import {
  BROWSE_AGENT_DEADLINE_MARGIN_MS,
  BROWSE_AGENT_DEADLINE_MS,
  BROWSE_AGENT_MAX_REQUESTS,
  BROWSE_AGENT_OUTER_TIMEOUT_MS,
  createBrowseAgentSession,
  goalRequiredResult,
  SetupError,
  createFixtureSetup,
  unmatchedMocks,
  createRunCheckpoint,
  singleUseTool,
  QA_VERDICT_TOOL,
  QA_VERDICT_FIELD,
  qaVerdictHooks,
  executeQaVerdict,
  qaResultOf,
  createStepRecorder,
  createBrowseTraceRecorder,
  mergeCarriedDialogs,
  QA_ASSERT_TOOL,
  QA_FINAL_CHECKS_TIMEOUT_MS,
  executeQaAssert,
  runFinalChecks,
  applyFinalChecks,
  finalChecksApply,
  parseQaChecks,
  parseJsonObject,
  qaJudgeApplies,
  judgePageOf,
  applyQaJudge,
  qaJudgeError,
  parseQaJudgeVerdict,
  QA_JUDGE_PAGE_MAX_CHARS,
  QA_JUDGE_TIMEOUT_MS,
  createTraceDomSource,
  type QaCheck,
  type QaJudgePage,
  type QaJudgeResult,
  type BrowseAgentResult,
} from "@sideform/browser-agent/agent/session";
import { executeBrowseTool } from "@sideform/browser-agent/agent/execute";
import { parsePageFixture, type FixtureNetworkRule } from "@sideform/browser-agent/fixture";
import { Chat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { getRequestUserId } from "@/lib/auth/authState";
import { apiFetch, resolveApiUrl } from "@/lib/apiBase";
import { combineSignals } from "@/lib/abortSignals";
import { createChatTransport, CLIENT_CAPABILITIES } from "@/lib/chatTransport";
import type { ToolHandler } from "../../toolRegistry";
import { CLOSE_SESSION_TIMEOUT_MS, closeBrowserSession, getBrowserBridge, isDesktopBrowserAvailable, type BrowserBridge } from "./bridge";
import { APP_NEEDS_DESKTOP_ERROR } from "./browseOpen";
import { peBase, safeParseObject } from "./shared";
import { APP_LAUNCH_ALLOWANCE_MS, appArgOf, desktopAppsAvailable, isIsolatedQaCall, rememberRunSession, runSessionId } from "./isolation";
import { acquireBrowseSlot } from "@/lib/browseRunLimiter";
import { tracesForAllRuns } from "@/lib/browseTracePref";
import { canSaveBrowseTrace, saveBrowseTrace } from "@/lib/browseTraces";
import { useBrowseAgentPhaseStore } from "@/store/browseAgentPhaseStore";
import { checkpointForModel, useBrowseCheckpointStore } from "@/store/browseCheckpointStore";

/**
 * browse_agent — runs a browse-only sub-agent as a nested, headless chat
 * session against the same /api/chat (`agentMode: "browse"`), pinned by the
 * backend to a non-reasoning deepseek model on OpenRouter whatever the user's
 * main model is, OpenCode Go included
 * (pen-editor-backend docs/specs/2026-10-14-browse-subagent-design.md).
 *
 * The control flow (deadline, abort, request cap, step count, allowlist,
 * status, result JSON) lives in `@sideform/browser-agent/agent/session`
 * (`createBrowseAgentSession`; the zod-free entry, so the editor's main chunk
 * carries no schemas or tool descriptions); this file only plugs in the nested `Chat`.
 *
 * Execution stays on the client: the nested session's tool calls go through
 * the normal `executeToolCall` with the PARENT chat's sessionId, so the same
 * browser (desktop IPC / cloud Steel keyed by chat id) and the same loop
 * guard serve both. The browse_* tools are unserialized in the tool queue and
 * so is browse_agent itself (toolCallQueue.ts) — otherwise the nested calls
 * would deadlock behind their own parent.
 *
 * A `qa: true` run on a desktop shell with `browser.isolated` gets its own
 * browser (the cloud browser has no isolation; its QA runs stay sequential in
 * the shared session): the nested context carries
 * `browserSession`, which `getBrowserBridge` and the loop guard honour, and the
 * session is closed in `finally`, AFTER the checkpoint capture. An isolated run
 * may use saved logins (`browse_fill_login`, routed to its session), may record
 * checkpoints (flagged `isolated`: resumable only by another isolated run, as
 * they hold the test account's cookies), and may `resume` one. Spec: pen-editor-desktop
 * docs/superpowers/specs/2026-10-17-isolated-parallel-browse-design.md.
 */

// Re-exported: useDesignChat and tests import the limits from here.
export {
  BROWSE_AGENT_OUTER_TIMEOUT_MS,
  BROWSE_AGENT_DEADLINE_MARGIN_MS,
  BROWSE_AGENT_DEADLINE_MS,
  BROWSE_AGENT_MAX_REQUESTS,
};
export type { BrowseAgentStatus } from "@sideform/browser-agent/agent/session";

const NESTED_ID_MAX_CHARS = 200;
/** Allowed only when the caller passed `capture: true` (the user's direct ask). */
const CAPTURE_TOOL = "browse_capture";
/** A normal tool (callable repeatedly: two-step sign-in), allowed only when the bridge the run uses has it. */
const FILL_LOGIN_TOOL = "browse_fill_login";
/**
 * Bound of one recorder journal call (default 15 s). Raised so a capture queued
 * behind a slow in-flight act at the deadline still has a chance; the cloud
 * capture fetch (25 s, cloudBrowser.ts) stays under it. A capture behind an act
 * longer than that still fails, and the run then has no checkpoint.
 */
const CHECKPOINT_CALL_TIMEOUT_MS = 30_000;
/**
 * Browsers with a browse_agent run that records right now. Runs sharing one
 * browser share one journal, so only the first records; the others run without
 * a checkpoint instead of replacing its journal. The key is the bridge
 * identity: the desktop shell has ONE shared browser for all chats ("desktop");
 * the cloud has one session per chat (the chat id); an isolated run has its own
 * browser, keyed by its session id.
 */
const recordingKeys = new Set<string>();
const DESKTOP_RECORDING_KEY = "desktop";
/**
 * Stand-in for a missing bridge. The package wants a bridge object even when the
 * helper is disabled (`enabled: false` creates no recorder and never calls it),
 * and a fixture setup only runs once a bridge exists. It is one cast in one
 * place; nothing may call it.
 */
const INERT_BRIDGE = {} as BrowserBridge;

/**
 * `qa_assert` bounded like any nested tool: at most QA_FINAL_CHECKS_TIMEOUT_MS, and it
 * stops on the run's abort signal, so the session's wait for pending tools cannot hang.
 */
async function boundedQaAssert(
  input: unknown,
  bridge: BrowserBridge,
  recorder: ReturnType<typeof createStepRecorder>,
  signal: AbortSignal,
  repro = false,
): Promise<string> {
  const fail = (message: string) => JSON.stringify({ error: `${QA_ASSERT_TOOL}: ${message}` });
  if (signal.aborted) return fail("aborted.");
  // A rejection of the assert itself is not a timeout: it goes on to the caller, as before.
  const out = await withTimeout<{ value: string } | { thrown: unknown } | undefined>(
    () =>
      executeQaAssert(input, bridge, recorder, repro ? { repro: true } : {}).then(
        (value) => ({ value }),
        (thrown: unknown) => ({ thrown }),
      ),
    QA_FINAL_CHECKS_TIMEOUT_MS,
    undefined,
    signal,
  );
  if (!out) return fail(signal.aborted ? "aborted." : "timed out.");
  if ("thrown" in out) throw out.thrown;
  return out.value;
}

/** Each page read for the QA judge may take this long. */
const QA_JUDGE_READ_MS = 5_000;
/** The trace recorder's last drain of the request log (`flush()` boxes itself at 2 s); reserved in the isolated QA tail when the run keeps one. Any run that keeps a trace (QA always; other runs when the all-runs setting is on) drains once, but only the isolated QA path reserves the time: plain runs rely on the package margin. */
const TRACE_FLUSH_RESERVE_MS = 2_000;
/** The server has its own QA_JUDGE_TIMEOUT_MS budget; the client waits a little longer than it. */
const QA_JUDGE_CLIENT_TIMEOUT_MS = QA_JUDGE_TIMEOUT_MS + 10_000;
/** The judge request must end this long before the tool's outer timeout (the rest of the run's cleanup runs beside it). */
const QA_JUDGE_TAIL_MARGIN_MS = 15_000;
/** With less than this left for the request, the judge is skipped. */
const QA_JUDGE_MIN_BUDGET_MS = 5_000;
const QA_JUDGE_TITLE_MAX_CHARS = 1024;
const QA_JUDGE_URL_MAX_CHARS = 4096;
const NO_TIME_FOR_JUDGE = "no time left for the judge";

// The judge endpoint's limits (pen-editor-backend), applied on the client so a long run is not refused.
const JUDGE_SCENARIO_MAX_CHARS = 8000;
const JUDGE_MAX_STEPS = 30;
const JUDGE_MAX_CHECKS = 400;
const JUDGE_STEP_ARGS_MAX_JSON = 2000;
const JUDGE_STEP_ERROR_MAX_CHARS = 500;
const JUDGE_CHECK_MAX_JSON = 2000;
const JUDGE_DIAGNOSTIC_MAX_CHARS = 500;
/** The route's bodyLimit is 160 KB; the client stays under this. */
const JUDGE_BODY_MAX_BYTES = 150_000;

type JudgeQa = NonNullable<ReturnType<typeof qaResultOf>>;

/**
 * Whether the backend has the judge route. "off" (a 404/405/501, `{disabled:true}`, or a 200 that is not a judge answer)
 * makes later runs skip the page reads and the request; "on" (an answer from the route) makes a failure BEFORE the request
 * visible as `qa.judge.error`. Per backend base URL; the page lives for one session, so it is never refreshed.
 */
type JudgeAvailability = "unknown" | "on" | "off";
/** A route found missing is looked up again after this long (a deploy may add it). */
const JUDGE_OFF_TTL_MS = 10 * 60_000;
const judgeAvailability = new Map<string, { state: JudgeAvailability; at: number }>();
const judgeBase = () => resolveApiUrl("");
const judgeAvailabilityOf = (): JudgeAvailability => {
  const entry = judgeAvailability.get(judgeBase());
  if (!entry) return "unknown";
  if (entry.state === "off" && Date.now() - entry.at >= JUDGE_OFF_TTL_MS) {
    judgeAvailability.delete(judgeBase());
    return "unknown";
  }
  return entry.state;
};
/** Test seam: forgets what the app learned about the judge route. */
export function resetJudgeAvailability(): void {
  judgeAvailability.clear();
}

/**
 * One bounded call: its value, or `onTimeout` when it ran out of time, rejected, or `signal` aborted.
 * A slow call keeps running in the background; its late result is dropped.
 */
async function withTimeout<T>(call: () => Promise<T>, ms: number, onTimeout: T, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      call().catch(() => onTimeout),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout), ms);
        if (signal) {
          onAbort = () => resolve(onTimeout);
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/** The package caps a check `target` at 80 chars, and the backend cuts it to 80. */
const JUDGE_TARGET_MAX_CHARS = 80;

const cutChars = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);

/** `value` when its JSON fits `max`; else the JSON as a string cut so that its own JSON fits, ending in an ellipsis. */
function capJson(value: unknown, max: number): unknown {
  const json = JSON.stringify(value) ?? "null";
  if (json.length <= max) return value;
  let keep = max - 10;
  let text = `${json.slice(0, keep)}…`;
  while (JSON.stringify(text).length > max && keep > 0) {
    keep -= 50;
    text = `${json.slice(0, Math.max(keep, 0))}…`;
  }
  return text;
}

type JudgeCheck = NonNullable<JudgeQa["checks"]>[number];

/** A check record as the endpoint takes it: `check` over its JSON limit becomes `{ type, cut: true }`; `actual` and `error` are cut. */
function capCheck(check: JudgeCheck): JudgeCheck {
  const type = (check.check as { type?: unknown } | undefined)?.type;
  return {
    ...check,
    ...(JSON.stringify(check.check).length > JUDGE_CHECK_MAX_JSON
      ? { check: { type: typeof type === "string" ? type.slice(0, 100) : "unknown", cut: true } }
      : {}),
    ...(typeof check.actual === "string" ? { actual: cutChars(check.actual, JUDGE_DIAGNOSTIC_MAX_CHARS) } : {}),
    ...(typeof check.error === "string" ? { error: cutChars(check.error, JUDGE_DIAGNOSTIC_MAX_CHARS) } : {}),
    ...(typeof check.target === "string" ? { target: cutChars(check.target, JUDGE_TARGET_MAX_CHARS) } : {}),
  } as JudgeCheck;
}

/** Exported for tests. At most `max` checks: every failed one first, then the latest passed ones; the original order is kept. */
export function limitChecks(checks: JudgeCheck[], max: number): JudgeCheck[] {
  if (checks.length <= max) return checks;
  const keep = new Set<number>();
  for (let i = checks.length - 1; i >= 0 && keep.size < max; i--) if (!checks[i].passed) keep.add(i);
  for (let i = checks.length - 1; i >= 0 && keep.size < max; i--) keep.add(i);
  return checks.filter((_, i) => keep.has(i));
}

/**
 * The `qa` fields the judge endpoint takes, cut to its limits. Never the verdict, the reason or the outcome,
 * and no `qa_verdict` step. Where a count limit applies the LAST entries are kept (checks: failed ones first).
 */
function judgeQaBody(qa: JudgeQa) {
  const steps = qa.steps
    .filter((step) => step.tool !== QA_VERDICT_TOOL)
    .slice(-JUDGE_MAX_STEPS)
    .map((step) => ({
      ...step,
      ...(step.args !== undefined ? { args: capJson(step.args, JUDGE_STEP_ARGS_MAX_JSON) } : {}),
      ...(typeof step.error === "string" ? { error: cutChars(step.error, JUDGE_STEP_ERROR_MAX_CHARS) } : {}),
    }));
  const diagnostics = (list: string[] | undefined) => list?.map((entry) => cutChars(entry, JUDGE_DIAGNOSTIC_MAX_CHARS));
  return {
    steps,
    ...(qa.stepsDropped !== undefined ? { stepsDropped: qa.stepsDropped } : {}),
    ...(qa.checks !== undefined ? { checks: limitChecks(qa.checks, JUDGE_MAX_CHECKS).map(capCheck) } : {}),
    ...(typeof qa.pageAtCheck?.url === "string" && typeof qa.pageAtCheck.title === "string"
      ? {
          pageAtCheck: {
            url: cutChars(qa.pageAtCheck.url, QA_JUDGE_URL_MAX_CHARS),
            title: cutChars(qa.pageAtCheck.title, QA_JUDGE_TITLE_MAX_CHARS),
          },
        }
      : {}),
    ...(qa.consoleErrors !== undefined ? { consoleErrors: diagnostics(qa.consoleErrors) } : {}),
    ...(qa.consoleErrorsDropped !== undefined ? { consoleErrorsDropped: qa.consoleErrorsDropped } : {}),
    ...(qa.failedRequests !== undefined ? { failedRequests: diagnostics(qa.failedRequests) } : {}),
    ...(qa.failedRequestsDropped !== undefined ? { failedRequestsDropped: qa.failedRequestsDropped } : {}),
  };
}

/** The page as the endpoint takes it: text, title and url cut to the endpoint's limits. */
function judgePageBody(page: QaJudgePage): QaJudgePage {
  const cutText = page.text.length > QA_JUDGE_PAGE_MAX_CHARS;
  return {
    url: cutChars(page.url, QA_JUDGE_URL_MAX_CHARS),
    title: cutChars(page.title, QA_JUDGE_TITLE_MAX_CHARS),
    text: cutChars(page.text, QA_JUDGE_PAGE_MAX_CHARS),
    ...(cutText || page.truncated ? { truncated: true } : {}),
  };
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/**
 * Exported for tests. The request body as JSON, within the route's body limit (JUDGE_BODY_MAX_BYTES of UTF-8). When it is over, in this order:
 * passed checks are dropped (oldest first), then step args become "…", then the page text is cut further (`truncated` set).
 */
export function judgeRequestJson(scenario: string, qaIn: JudgeQa, pageIn: QaJudgePage): string {
  const qa = judgeQaBody(qaIn);
  const page = judgePageBody(pageIn);
  const build = () => JSON.stringify({ scenario: cutChars(scenario, JUDGE_SCENARIO_MAX_CHARS), qa, page });
  let json = build();
  const over = () => utf8Bytes((json = build())) > JUDGE_BODY_MAX_BYTES;
  if (!over()) return json;
  if (qa.checks) {
    // The first batch of passed checks goes at once; the real size is re-measured after each batch.
    while (over()) {
      const index = qa.checks.findIndex((c) => c.passed);
      if (index < 0) break;
      qa.checks.splice(index, 1);
    }
  }
  for (const step of qa.steps) {
    if (!over()) return json;
    step.args = "…";
  }
  while (over() && page.text.length > 0) {
    page.text = page.text.slice(0, Math.floor(page.text.length * 0.8));
    page.truncated = true;
  }
  return json;
}

/**
 * POST /api/browse/judge (same transport as the chat: base URL and session cookie via apiFetch).
 * Never rejects: a failure, a timeout or an abort is `{ error }`. A route the backend does not have (404, 405, 501),
 * `{ disabled: true }` and a 200 that is not a judge answer are "disabled". Records what it learned in `judgeAvailability`.
 */
async function askJudgeBackend(
  body: { scenario: string; qa: JudgeQa; page: QaJudgePage },
  signals: Array<AbortSignal | undefined>,
  timeoutMs: number,
): Promise<QaJudgeResult | "disabled"> {
  const base = judgeBase();
  const setAvailability = (state: JudgeAvailability) => judgeAvailability.set(base, { state, at: Date.now() });
  let timeout: AbortSignal | undefined;
  let signal: AbortSignal | undefined;
  try {
    // Built inside the try: a runtime without these APIs gives `{ error }`, never a rejection.
    timeout = AbortSignal.timeout(timeoutMs);
    signal = combineSignals([...signals, timeout]);
    const res = await apiFetch("/api/browse/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: judgeRequestJson(body.scenario, body.qa, body.page),
      signal,
    });
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      setAvailability("off");
      return "disabled";
    }
    // Too large says nothing about the route: an error, the state stays.
    if (res.status === 413) return qaJudgeError("judge request too large");
    const data = parseJsonObject(await res.text());
    const judgeShaped = "verdict" in data || "error" in data || "disabled" in data;
    if (!res.ok) {
      // A JSON `error` is the judge route's own answer; any other failure says nothing about the route.
      if (typeof data.error === "string" && data.error) {
        setAvailability("on");
        return qaJudgeError(data.error);
      }
      return qaJudgeError(`judge responded ${res.status}`);
    }
    if (data.disabled === true || !judgeShaped) {
      setAvailability("off");
      return "disabled";
    }
    setAvailability("on");
    if (typeof data.error === "string") return qaJudgeError(data.error);
    const parsed = parseQaJudgeVerdict(data);
    return parsed.ok ? parsed.value : qaJudgeError(`invalid judge answer: ${parsed.errors.join("; ")}`);
  } catch (error) {
    return qaJudgeError(timeout?.aborted ? "judge request timed out" : signal?.aborted ? "aborted" : error);
  }
}

export function nestedChatId(sessionId: string | undefined, toolCallId: string | undefined): string {
  const raw = `browse.${sessionId ?? "no-session"}.${toolCallId ?? Date.now()}`;
  return raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, NESTED_ID_MAX_CHARS);
}

/**
 * The handler. An isolated QA run takes one of MAX_PARALLEL_BROWSE_RUNS slots
 * BEFORE it opens its browser session and gives it back after the session is
 * closed, so every caller (chat, the MCP bridges, WebMCP) is capped the same.
 * The wait for a slot is inside the handler: the tool's outer timeout covers
 * wait plus run, and an abort while waiting answers "aborted" with no browser.
 */
export const browseAgent: ToolHandler = async (args, context) => {
  // The tool's outer timeout started now: the QA judge has to end before it.
  const outerEnd =
    Date.now() + (context?.timeoutMs ?? BROWSE_AGENT_OUTER_TIMEOUT_MS + (appArgOf(args) ? APP_LAUNCH_ALLOWANCE_MS : 0));
  // Stops a started judge request when anything throws after it started (the body or the cleanup): nobody awaits it then.
  const judgeAbort = new AbortController();
  let outcome: RunOutcome;
  try {
    outcome = await runWithCleanup(args, context, outerEnd, judgeAbort.signal);
  } catch (error) {
    judgeAbort.abort();
    throw error;
  }
  // The QA judge request is awaited only here, after ALL cleanup (viewport reset, session close, slot release).
  return typeof outcome === "string" ? outcome : outcome();
};

const runWithCleanup = async (
  args: Record<string, unknown>,
  context: Parameters<ToolHandler>[1],
  outerEnd: number,
  judgeSignal: AbortSignal,
): Promise<RunOutcome> => {
  // Confirm + launch of an app must not eat the agent's step budget: the inner deadline grows by the same allowance as the outer timeout.
  const appAllowance = appArgOf(args) ? APP_LAUNCH_ALLOWANCE_MS : 0;
  if (!isIsolatedQaCall(args)) {
    return runBrowseAgent(args, context, undefined, appAllowance ? BROWSE_AGENT_DEADLINE_MS + appAllowance : undefined, outerEnd, judgeSignal);
  }
  const waitStart = Date.now();
  const slot = await acquireBrowseSlot(context?.signal ?? new AbortController().signal);
  if (!slot) return JSON.stringify({ status: "aborted", steps: 0 });
  try {
    // The tool's outer timeout started when the handler did, so the wait for a
    // slot is spent: the run's own deadline shrinks by it.
    // After the run, inside the same outer timeout, comes the tail: the checkpoint
    // capture (bounded by CHECKPOINT_CALL_TIMEOUT_MS), the journal stop, then the
    // session close (bounded by CLOSE_SESSION_TIMEOUT_MS).
    // Final checks (`checks`) run after the loop too: reserve their bound as well.
    const checksReserve = args.checks !== undefined && args.checks !== null ? QA_FINAL_CHECKS_TIMEOUT_MS : 0;
    // A QA run on a bridge that serves the request log drains it once more after the loop.
    const flushReserve =
      args.qa === true && canSaveBrowseTrace(isDesktopBrowserAvailable()) && typeof getBrowserBridge(context?.sessionId)?.requests === "function"
        ? TRACE_FLUSH_RESERVE_MS
        : 0;
    const deadlineMs =
      BROWSE_AGENT_DEADLINE_MS + appAllowance - (Date.now() - waitStart) - CHECKPOINT_CALL_TIMEOUT_MS - CLOSE_SESSION_TIMEOUT_MS - checksReserve - flushReserve;
    if (deadlineMs < MIN_ISOLATED_RUN_MS) {
      return JSON.stringify({
        status: "error",
        steps: 0,
        error: "Waited too long for a free parallel browser slot to run this scenario; call it again.",
      });
    }
    const runSession = runSessionId(context?.sessionId, context?.toolCallId);
    if (context?.toolCallId) rememberRunSession(context.toolCallId, runSession);
    try {
      return await runBrowseAgent(args, context, runSession, deadlineMs, outerEnd, judgeSignal);
    } finally {
      // Whatever happened inside (a throw during setup parsing included), the
      // session is closed, after the fixture release and before the slot is freed.
      try {
        await closeBrowserSession(runSession);
      } finally {
        // Empties the run's ring. TODO(debt): the package has no way to drop the
        // ring's map KEY, so one empty entry stays per run; needs `dropLoopGuard`
        // in @sideform/browser-agent/loop.
        resetLoopGuard(runSession);
      }
    }
  } finally {
    slot.release();
  }
};

/**
 * What a run hands to the handler: the result JSON, or (a QA run whose `passed` outcome the judge reviews)
 * a function that waits for the judge request and returns the JSON. The handler calls it last.
 */
type RunOutcome = string | (() => Promise<string>);

/** Below this much deadline left after waiting for a slot, an isolated run is not worth starting. */
const MIN_ISOLATED_RUN_MS = 60_000;

/** Bound of the final trace screenshot of any run that keeps a trace (QA always; other runs when the all-runs setting is on). */
const FINAL_FRAME_TIMEOUT_MS = 4_000;

/** Bound of the run-end viewport reset, as the package's runBrowseAgent. */
const CLEAR_EMULATION_TIMEOUT_MS = 5_000;

/**
 * Ends the `browse_act` `viewport` layers (browser-agent v0.2.23). Every run end calls it,
 * with or without a fixture, AFTER the fixture release. Bounded; a rejection is ignored; an
 * older shell without the method is skipped. A viewport the MAIN model set in manual mode
 * (browse_act called directly, no browse_agent run) persists until the next browse_agent
 * run end or a fixture release.
 */
async function clearActEmulation(bridge: BrowserBridge | undefined): Promise<void> {
  // A reset must not change the run's result: a rejection or a hang is ignored.
  await withTimeout(async () => void (await bridge?.clearActEmulation?.()), CLEAR_EMULATION_TIMEOUT_MS, undefined);
}

/** Bound of the run-end app release. */
const RELEASE_APP_TIMEOUT_MS = 5_000;

/** Hands the browser back from an app a run launched (desktop `releaseApp`). Bounded; never changes the result. */
async function releaseApp(bridge: BrowserBridge | undefined): Promise<void> {
  await withTimeout(async () => void (await bridge?.releaseApp?.()), RELEASE_APP_TIMEOUT_MS, undefined);
}

/**
 * A page screenshot as a trace frame. The recorder normalizes the image itself. The screenshot drains the page's pending
 * JS dialogs like every controller command: they go back as `dialogs`, for the recorder to hand to the tool output.
 * Throws or gives undefined when there is none; the recorder bounds it and ignores a failure.
 */
async function captureTraceFrame(bridge: BrowserBridge): Promise<{ imageData: string; width?: number; height?: number; dialogs?: unknown[] } | undefined> {
  const out = (await bridge.screenshot?.({})) as { imageData?: unknown; width?: unknown; height?: unknown; dialogs?: unknown } | null | undefined;
  if (typeof out?.imageData !== "string" || out.imageData === "") return undefined;
  return {
    imageData: out.imageData,
    ...(typeof out.width === "number" ? { width: out.width } : {}),
    ...(typeof out.height === "number" ? { height: out.height } : {}),
    ...(Array.isArray(out.dialogs) && out.dialogs.length > 0 ? { dialogs: out.dialogs } : {}),
  };
}

/** `mergeCarriedDialogs` for a tool output that is a JSON string or an already-parsed object. */
function withCarriedDialogs<T>(output: T, dialogs: readonly unknown[] | undefined): T | string {
  if (typeof output === "string") return mergeCarriedDialogs(output, dialogs);
  if (!dialogs || dialogs.length === 0 || !output || typeof output !== "object" || Array.isArray(output)) return output;
  const own = (output as { dialogs?: unknown }).dialogs;
  return { ...output, dialogs: [...(Array.isArray(own) ? own : []), ...dialogs] };
}

/** The trace label of a run's `app` (a name or a path): "/Applications/Orca.app" → "Orca". */
export function appLabelOf(app: string): string {
  const last = app.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? app;
  return last.replace(/\.app$/i, "") || app;
}

/** A run whose `app` this run launched (set before the launch call: a launch that timed out may still have started). */
type AppRun = { launched: boolean };

const runBrowseAgent = async (
  args: Record<string, unknown>,
  context: Parameters<ToolHandler>[1],
  runSession: string | undefined,
  deadlineMs: number | undefined,
  outerEnd: number,
  judgeSignal: AbortSignal,
): Promise<RunOutcome> => {
  const appRun = { launched: false };
  try {
    return await runBrowseAgentBody(args, context, runSession, deadlineMs, outerEnd, judgeSignal, appRun);
  } finally {
    const bridge = getBrowserBridge(context?.sessionId, runSession);
    await clearActEmulation(bridge);
    // Only an app THIS run launched: one the chat opened with browse_open stays.
    // Also when the launch is still pending (timeout, abort): the desktop's
    // releaseApp cancels a pending launch, so calling it here is correct.
    if (appRun.launched) await releaseApp(bridge);
  }
};

const runBrowseAgentBody = async (
  args: Record<string, unknown>,
  context: Parameters<ToolHandler>[1],
  runSession: string | undefined,
  deadlineMs: number | undefined,
  outerEnd: number,
  judgeSignal: AbortSignal,
  appRun: AppRun,
): Promise<RunOutcome> => {
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  if (!goal) return JSON.stringify(goalRequiredResult());
  const url = typeof args.url === "string" ? args.url.trim() : "";
  const app = appArgOf(args) ?? "";
  if (app) {
    const refuse = (error: string) => JSON.stringify({ status: "error", steps: 0, error });
    if (url || (args.setup !== undefined && args.setup !== null) || (args.resume !== undefined && args.resume !== null)) {
      return refuse("`app` cannot be combined with url, setup or resume: the app is the start, not a page.");
    }
    if (!desktopAppsAvailable()) return refuse(APP_NEEDS_DESKTOP_ERROR);
  }
  // The gate: browse_capture reaches the subagent only on the main agent's
  // explicit `capture: true` (spec 2026-10-15-browse-capture-design.md).
  const captureAllowed = args.capture === true;

  // QA mode: the nested run gets the QA prompt and `qa_verdict`; the verdict ends it.
  // A QA run with `resume` is allowed only when it is isolated (it continues a
  // scenario in its own browser); in the shared browser it stays a fresh scenario.
  const qaOn = args.qa === true;
  if (qaOn && !runSession && args.resume !== undefined && args.resume !== null) {
    return JSON.stringify({
      status: "error",
      steps: 0,
      error: "`resume` cannot be combined with `qa: true`: a QA run is a fresh scenario.",
    });
  }
  const hasChecks = args.checks !== undefined && args.checks !== null;
  if (hasChecks && !qaOn) {
    return JSON.stringify({ status: "error", steps: 0, error: "`checks` need `qa: true`: final checks belong to a QA run." });
  }
  // The bridge this run really uses (the isolated session's, or the shared one).
  const bridge = getBrowserBridge(context?.sessionId, runSession);
  // Assertions: only when this bridge has `assert` (an older shell lacks it; the cloud bridge has it).
  const assertAllowed = typeof bridge?.assert === "function";
  // Final checks (QA only): run once after the loop through the bridge `assert`.
  let finalChecks: QaCheck[] | undefined;
  if (qaOn && hasChecks) {
    const parsedChecks = parseQaChecks(args.checks);
    if (!parsedChecks.ok) {
      return JSON.stringify({ status: "error", steps: 0, error: `checks: ${parsedChecks.errors.join("; ")}` });
    }
    if (parsedChecks.value.length > 0) {
      if (!assertAllowed) {
        return JSON.stringify({ status: "error", steps: 0, error: "Final checks need a browser that supports assertions." });
      }
      finalChecks = parsedChecks.value;
    }
  }
  const recorder = qaOn ? createStepRecorder() : undefined;
  // The run trace (spec 2026-10-20-browse-run-trace-design.md): steps, a frame after each page-changing step, QA at the end.
  const desktopRun = isDesktopBrowserAvailable();
  // QA runs keep a trace; so does every run when the "record traces for all runs" setting is on. A desktop shell
  // without a save bridge (older) cannot keep one either: no recorder, so no screenshots are taken.
  const traceRecorder = (qaOn || tracesForAllRuns()) && canSaveBrowseTrace(desktopRun)
    ? createBrowseTraceRecorder({
        goal,
        labels: { browser: desktopRun ? "desktop" : "cloud", mode: qaOn ? "qa" : "browse", ...(app ? { app: appLabelOf(app) } : {}) },
        ...(typeof bridge?.screenshot === "function" ? { capture: () => captureTraceFrame(bridge) } : {}),
        // DOM snapshot of failed steps (viewer: Screenshot / DOM). Needs a bridge that can read the page at all.
        ...(bridge && typeof bridge.capture === "function" ? { captureDom: createTraceDomSource(bridge) } : {}),
        // Network log of the page; a shell without `requests` records none.
        ...(typeof bridge?.requests === "function" ? { requests: () => bridge.requests!() } : {}),
        repro: true,
      })
    : undefined;

  // Playwright export: only a run that keeps a trace records the repro captures. The run's setup (a fixture, or the app).
  if (traceRecorder) {
    const reproSetup = app ? { app: true } : args.setup && typeof args.setup === "object" && !Array.isArray(args.setup) ? args.setup : undefined;
    traceRecorder.setRepro({ setup: reproSetup as Parameters<typeof traceRecorder.setRepro>[0]["setup"] });
  }
  const reproOn = !!traceRecorder;

  const flushReserve = traceRecorder && typeof bridge?.requests === "function" ? TRACE_FLUSH_RESERVE_MS : 0;

  const parentSessionId = context?.sessionId;
  // Isolated QA run (spec 2026-10-17-isolated-parallel-browse-design.md): its own
  // browser for every nested command, closed in `finally`. A plain run, or a
  // client without isolation, keeps the shared browser exactly as before.
  const browserContext = runSession ? { browserSession: runSession } : {};

  // Saved logins: desktop only, and only when the bridge this run really uses
  // (the isolated session's, or the shared one) has `fillLogin`. An older shell
  // or the cloud bridge keeps today's behavior. The nested `browse_fill_login`
  // call carries `browserSession` (browserContext), so it fills in the same browser.
  const loginAllowed = typeof bridge?.fillLogin === "function";

  // Lazy: useDesignChat imports toolRegistry, which imports this module.
  const { executeToolCall } = await import("@/hooks/useDesignChat");

  // Every screenshot the sub-agent put on the canvas, in order: the parent cannot otherwise tell which image is which.
  const placed: { nodeId: string; url?: string }[] = [];
  const notePlacedScreenshot = (toolName: string, output: unknown): void => {
    if (toolName !== "browse_screenshot" || typeof output !== "string" || !output.includes('"placedNodeId"')) return;
    const shot = safeParseObject(output);
    if (typeof shot.placedNodeId === "string") {
      placed.push({ nodeId: shot.placedNodeId, ...(typeof shot.url === "string" ? { url: shot.url } : {}) });
    }
  };

  const session = createBrowseAgentSession({
    signal: context?.signal,
    ...(deadlineMs !== undefined ? { deadlineMs } : {}),
    extraTools: {
      ...(loginAllowed ? { [FILL_LOGIN_TOOL]: {} } : {}),
      // qa_verdict is single-use and ends the run; qa_assert is neither (no hooks).
      ...(qaOn ? { [QA_VERDICT_TOOL]: { ...qaVerdictHooks() }, ...(assertAllowed ? { [QA_ASSERT_TOOL]: {} } : {}) } : {}),
      ...(captureAllowed
      ? {
          [CAPTURE_TOOL]: singleUseTool({
            name: CAPTURE_TOOL,
            isSuccess: (p) => typeof p.nodeId === "string",
            fields: (p) => ({
              captured: { nodeId: p.nodeId, width: p.width, height: p.height, url: p.url, title: p.title },
            }),
            doneMessage: (p) =>
              `browse_capture already ran in this task; the page is on the canvas as ${String(p.nodeId) || "an existing node"}.`,
          }),
        }
      : {}),
    },
    executeTool: async (call, { signal }) => {
      // Guard-refused calls never reach here, so the trail holds model calls that ran.
      let end: ReturnType<NonNullable<typeof recorder>["onToolCall"]> | undefined;
      let traceEnd: ReturnType<NonNullable<typeof traceRecorder>["onToolCall"]> | undefined;
      try {
        end = recorder?.onToolCall(call);
        traceEnd = traceRecorder?.onToolCall(call, { signal });
      } catch {
        // An observer must not change the run.
      }
      try {
        const output =
          qaOn && call.toolName === QA_VERDICT_TOOL
            ? executeQaVerdict(call.input)
            : qaOn && recorder && assertAllowed && call.toolName === QA_ASSERT_TOOL
              ? await boundedQaAssert(call.input, bridge ?? INERT_BRIDGE, recorder, signal, reproOn)
              : await executeToolCall(
                call.toolName,
                call.input,
                { sessionId: parentSessionId, ...browserContext, ...(reproOn ? { repro: true } : {}), toolCallId: call.toolCallId, signal },
                "browse_agent",
              );
        end?.({ output });
        notePlacedScreenshot(call.toolName, output);
        // Awaited: the step frame must show the page right after this step.
        const carried = await traceEnd?.({ output }).catch(() => undefined);
        // The trace screenshot drained dialogs the model has not seen yet: put them into its result.
        return withCarriedDialogs(output, carried?.dialogs);
      } catch (err) {
        end?.({ error: err });
        await traceEnd?.({ error: err }).catch(() => undefined);
        throw err;
      }
    },
  });

  const chat: Chat<UIMessage> = new Chat<UIMessage>({
    id: nestedChatId(parentSessionId, context?.toolCallId),
    transport: createChatTransport({
      // No canvasContext: the sub-agent never sees the scene. No model
      // either: the backend pins its own (OpenRouter), so no OpenCode key
      // header is sent.
      body: () => ({
        agentMode: "browse",
        ...(captureAllowed ? { browseCapture: true } : {}),
        ...(qaOn ? { browseQa: true } : {}),
        // Per run, from the bridge this run uses: the static capability may differ (isolated session, older shell).
        // canvasTabs off: the sub-agent has no chat-to-canvas binding, so it is never offered open_canvas_tab.
        clientCapabilities: { ...CLIENT_CAPABILITIES, canvasTabs: false, browseAssert: assertAllowed },
        ...(loginAllowed ? { browseLogin: true } : {}),
        userId: getRequestUserId(),
      }),
    }),
    sendAutomaticallyWhen: (options) => lastAssistantMessageIsCompleteWithToolCalls(options) && session.continueRequest(),
    onError: (err) => session.recordError(err),
    // Awaited like the main chat's onToolCall so the stream stays open until
    // the result is in. The output is always written, even after a stop: an
    // input-available part with no output would poison later requests (same
    // rule as useDesignChat).
    onToolCall: async ({ toolCall }) => {
      await session.runTool(
        { toolName: toolCall.toolName, input: toolCall.input, toolCallId: toolCall.toolCallId },
        (output) => chat.addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output }),
      );
    },
  });

  // Fresh loop-guard ring: nested calls share the parent's sessionId (an
  // isolated run has its own ring, keyed by its session).
  resetLoopGuard(runSession ?? parentSessionId);

  const driver = {
    send: (text: string) => chat.sendMessage({ text }),
    stop: () => void chat.stop(),
    messages: () => chat.messages,
    error: () => chat.error,
  };
  const toolCallId = context?.toolCallId;
  const setup = args.setup;
  const hasSetup = setup !== undefined && setup !== null;
  const resumeId = typeof args.resume === "string" ? args.resume.trim() : "";
  const hasResume = args.resume !== undefined && args.resume !== null;
  // Without a chat id checkpoints are OFF (no safe place to keep or clear them).
  const checkpointChat = parentSessionId;
  // An isolated run has its own browser and journal: its session id is the key,
  // so parallel isolated runs each record.
  const recordingKey = runSession ?? (isDesktopBrowserAvailable() ? DESKTOP_RECORDING_KEY : checkpointChat);

  // Checkpoint (spec 2026-10-16-checkpoint-design.md): the package's
  // createRunCheckpoint owns the lifecycle (bounded start, capture conditions,
  // release before stop, bounded stop wait). The fixture stays in
  // browseCheckpointStore; the model only gets id, complete, summary, gap.
  // The journal starts only once the input is valid (`valid`), and only when no
  // other run of this browser records; otherwise the helper is disabled, so
  // there is still one cleanup path.
  const signal = context?.signal;
  let startGeneration = 0;
  let network: FixtureNetworkRule[] | undefined;
  const openCheckpoint = (valid: boolean) => {
    const key = recordingKey;
    const enabled = valid && !!bridge && !!checkpointChat && !!key && !recordingKeys.has(key);
    if (enabled && key && checkpointChat) {
      recordingKeys.add(key);
      startGeneration = useBrowseCheckpointStore.getState().generation(checkpointChat);
    }
    const cp = createRunCheckpoint(bridge ?? INERT_BRIDGE, { enabled: enabled && !!bridge, signal, timeoutMs: CHECKPOINT_CALL_TIMEOUT_MS });
    // The slot frees once the journal calls have really settled. The package caps
    // `settled` at 2 x timeoutMs (60 s here): a stop that hangs longer may overlap
    // the next run's journal (the owner tokens protect on current bridges).
    if (enabled && key) void cp.settled.then(() => recordingKeys.delete(key));
    return cp;
  };
  // `cp.finish` (and so the fixture release in `beforeStop`) must run exactly
  // once per run: the host guards it, the package's disabled mode does not memoize.
  let finished = false;
  /** Ends the run: capture, `beforeStop` (fixture release), stop. NOT idempotent: call once (see `finished`). Returns the model-safe checkpoint. */
  const finishCheckpoint = async (
    cp: ReturnType<typeof openCheckpoint>,
    result: Pick<BrowseAgentResult, "status" | "steps">,
    beforeStop?: () => Promise<unknown>,
  ): Promise<ReturnType<typeof checkpointForModel> | undefined> => {
    finished = true;
    const taken = await cp.finish(result, { beforeStop });
    if (!taken?.ok || !checkpointChat) return undefined;
    // Skip when the chat was cleared/deleted meanwhile (closeChat/clearChat bump
    // the generation): the fixture holds secrets and must not recreate the chat's
    // entry. A Stop alone keeps the capture: it is useful for resume.
    if (useBrowseCheckpointStore.getState().generation(checkpointChat) !== startGeneration) return undefined;
    return checkpointForModel(
      useBrowseCheckpointStore.getState().add(checkpointChat, {
        fixture: taken.fixture,
        // Holds the test account's cookies: resumable only in an isolated run.
        ...(runSession ? { isolated: true as const } : {}),
        ...(network && network.length > 0 ? { network } : {}),
        complete: taken.complete,
        ...(taken.gap !== undefined ? { gap: taken.gap } : {}),
        summary: taken.summary,
      }),
    );
  };
  // Only used when the run threw before finishing: no capture by design (aborted, 0 steps).
  const THREW_RESULT: Pick<BrowseAgentResult, "status" | "steps"> = { status: "aborted", steps: 0 };
  /**
   * The `qa` field: steps, run-level diagnostics and checks. The host's final checks run here, BEFORE
   * the checkpoint finish releases the fixture mocks (the package does the same order).
   */
  /**
   * A non-QA run that keeps a trace (the all-runs setting): the final frame and the last log drain, no verdict.
   * A QA run does both inside `buildQa`, around its final checks, so this leaves it alone.
   */
  const finishTraceCapture = async (result: BrowseAgentResult) => {
    if (recorder || !traceRecorder) return;
    await takeFinalFrame(result);
    await traceRecorder.flush();
  };
  const buildQa = async (result: BrowseAgentResult) => {
    if (!recorder) return undefined;
    await takeFinalFrame(result);
    let qa = qaResultOf(result, recorder.steps(), recorder.extras(), recorder.lastAgentCall());
    if (finalChecks && finalChecksApply(qa)) {
      const finalResults = await runFinalChecks(bridge ?? INERT_BRIDGE, finalChecks, recorder);
      // The final assert drained more errors into the recorder: refresh the run-level lists.
      qa = applyFinalChecks({ ...qa, ...recorder.extras() }, finalResults);
    }
    // Last drain of the request log, while the run's browser still lives (the cleanup closes an isolated session).
    // Self-time-boxed (2 s) and never rejects.
    await traceRecorder?.flush();
    return qa;
  };
  /**
   * The "final" trace frame: one screenshot of the page as the run left it, before the final checks, the
   * judge's read and the cleanup. Not for a run that was stopped, ran out of time or never started. Bounded; a
   * failure is ignored. The dialogs the screenshot drains are dropped: the run is over, no tool result is left to carry them.
   */
  const takeFinalFrame = async (result: BrowseAgentResult) => {
    if (!traceRecorder || typeof bridge?.screenshot !== "function" || signal?.aborted) return;
    if (result.status === "aborted" || result.status === "timeout" || result.status === "setup_failed") return;
    const shot = await withTimeout(() => captureTraceFrame(bridge).catch(() => undefined), FINAL_FRAME_TIMEOUT_MS, undefined, signal);
    if (shot) traceRecorder.addFrame({ imageData: shot.imageData, kind: "final", width: shot.width, height: shot.height });
  };
  /**
   * The QA judge (spec 2026-10-19-qa-judge-design.md): for a `passed` outcome, reads the final page NOW (the
   * fixture mocks still live) through the run's own bridge (the isolated session's browser for an isolated run;
   * not through executeToolCall, so the parent chat's loop guard and analytics never see it), starts the request
   * WITHOUT awaiting it and returns `settle`, which the handler awaits after ALL cleanup. The job never rejects.
   * The request ends at least QA_JUDGE_TAIL_MARGIN_MS before the tool's outer timeout.
   * A judge the backend does not have ("off") costs nothing. A failure before the request shows as `qa.judge.error`
   * only once the route is known to exist ("on"); otherwise the result stays as it was.
   */
  const startJudge = async (qa: Awaited<ReturnType<typeof buildQa>>): Promise<(() => Promise<typeof qa>) | undefined> => {
    if (!qa || !qaJudgeApplies(qa) || judgeAvailabilityOf() === "off") return undefined;
    const judgeFailed = (error: string) => async () => (judgeAvailabilityOf() === "on" ? applyQaJudge(qa, { error }) : qa);
    if (signal?.aborted) return judgeFailed("aborted");
    const timeLeft = () => outerEnd - Date.now() - QA_JUDGE_TAIL_MARGIN_MS;
    // Both reads, then the cleanup tail the run reserves, must fit before the margin.
    if (timeLeft() < 2 * QA_JUDGE_READ_MS + CHECKPOINT_CALL_TIMEOUT_MS + (runSession ? CLOSE_SESSION_TIMEOUT_MS : 0) + flushReserve) return judgeFailed(NO_TIME_FOR_JUDGE);
    const nested = (name: string, input: Record<string, unknown>) =>
      withTimeout<string | undefined>(() => executeBrowseTool(bridge, name, input, peBase), QA_JUDGE_READ_MS, undefined, signal);
    const read = await nested("browse_read", { maxChars: QA_JUDGE_PAGE_MAX_CHARS });
    if (signal?.aborted) return judgeFailed("aborted");
    const parsedRead = read === undefined ? {} : parseJsonObject(read);
    const complete = typeof parsedRead.text === "string" && parsedRead.text !== "" && typeof parsedRead.url === "string" && parsedRead.url !== "";
    const snapshot = complete ? undefined : await nested("browse_snapshot", {});
    if (signal?.aborted) return judgeFailed("aborted");
    const page = judgePageOf(read, snapshot);
    if ("error" in page) return judgeFailed(page.error);
    const left = timeLeft();
    if (left < QA_JUDGE_MIN_BUDGET_MS) return judgeFailed(NO_TIME_FOR_JUDGE);
    const job = askJudgeBackend({ scenario: goal, qa, page }, [signal, judgeSignal], Math.min(QA_JUDGE_CLIENT_TIMEOUT_MS, left));
    return async () => {
      const judged = await job;
      return judged === "disabled" ? qa : applyQaJudge(qa, judged);
    };
  };
  // Hit counts of the fixture's network mocks. Set once the fixture setup exists; read after the release, so
  // the rules that answered no request reach `qa.unmatchedMocks` (the package's `assemble` does the same).
  let readMockHits: () => Parameters<typeof unmatchedMocks>[0] = () => undefined;
  const withUnmatchedMocks = <Q extends JudgeQa | undefined>(q: Q): Q => {
    if (!q) return q;
    const unmatched = unmatchedMocks(readMockHits());
    return unmatched.length > 0 ? { ...q, unmatchedMocks: unmatched } : q;
  };
  const toJson = (result: BrowseAgentResult, extraIn: Record<string, unknown>, checkpoint: unknown, qa: Awaited<ReturnType<typeof buildQa>>): string => {
    const extra = placed.length ? { ...extraIn, placed } : extraIn;
    if (!recorder) return JSON.stringify({ ...result, ...extra, ...(checkpoint ? { checkpoint } : {}) });
    // Key order as the package's runBrowseAgent: `qa` before `error` and `setupStage`; the verdict field is folded into `qa`.
    const { error, setupStage, [QA_VERDICT_FIELD]: _verdict, ...rest } = result as BrowseAgentResult & Record<string, unknown>;
    return JSON.stringify({
      ...rest,
      ...extra,
      ...(checkpoint ? { checkpoint } : {}),
      qa,
      ...(error !== undefined ? { error } : {}),
      ...(setupStage !== undefined ? { setupStage } : {}),
    });
  };

  /**
   * The run's result: a function the handler awaits after ALL cleanup. It waits for the judge (if one is pending), then
   * closes the trace with the final qa (judge included), stores it and adds `trace: { id, source }` when that worked.
   */
  const finishJson = (
    result: BrowseAgentResult,
    extra: Record<string, unknown>,
    checkpoint: unknown,
    qa: Awaited<ReturnType<typeof buildQa>>,
    settleJudge: Awaited<ReturnType<typeof startJudge>>,
  ): RunOutcome =>
    async () => {
      const finalQa = withUnmatchedMocks(settleJudge ? await settleJudge() : qa);
      const saved = traceRecorder && await saveBrowseTrace(
        traceRecorder.finish({
          status: result.status,
          ...(typeof result.answer === "string" ? { answer: result.answer } : {}),
          ...(typeof result.error === "string" ? { error: result.error } : {}),
          ...(finalQa ? { qa: finalQa } : {}),
        }),
        desktopRun,
        { outerEnd, signal },
      );
      return toJson(result, saved ? { ...extra, trace: saved } : extra, checkpoint, finalQa);
    };

  if (!hasSetup && !hasResume) {
    // An external app cannot be resumed from a browser journal: no checkpoint for an app run.
    const cp = openCheckpoint(!app);
    try {
      await cp.begin();
      const result = await session.run(
        goal,
        driver,
        app
          ? {
              toolCallId,
              // The pre-open for an app: browse_open { app } through the same executor as the model's own call.
              setup: async ({ signal: runSignal }) => {
                appRun.launched = true;
                const openInput = { app };
                // The launch is the trace's first step (it skips executeTool, the model's own path), with a frame of the app window.
                let traceEnd: ReturnType<NonNullable<typeof traceRecorder>["onToolCall"]> | undefined;
                try {
                  // The session signal: it also aborts at the run deadline, so no frame is taken for a launch that outlived the run.
                  traceEnd = traceRecorder?.onToolCall({ toolName: "browse_open", input: openInput }, { signal: runSignal });
                } catch {
                  // An observer must not change the run.
                }
                let opened: string;
                try {
                  opened = await executeToolCall(
                    "browse_open",
                    openInput,
                    { sessionId: parentSessionId, ...browserContext, toolCallId: `${toolCallId ?? "browse_agent"}:open`, signal },
                    "browse_agent",
                  );
                } catch (err) {
                  await traceEnd?.({ error: err }).catch(() => undefined);
                  throw err;
                }
                const parsedOpen = parseJsonObject(opened);
                if (typeof parsedOpen.error === "string") {
                  await traceEnd?.({ error: parsedOpen.error }).catch(() => undefined);
                  throw new SetupError("open", parsedOpen.error);
                }
                const carried = await traceEnd?.({ output: opened }).catch(() => undefined);
                return withCarriedDialogs(opened, carried?.dialogs);
              },
            }
          : { url: url || undefined, toolCallId },
      );
      await finishTraceCapture(result);
      const qa = await buildQa(result);
      const settleJudge = await startJudge(qa);
      const checkpoint = await finishCheckpoint(cp, result);
      return finishJson(result, {}, checkpoint, qa, settleJudge);
    } finally {
      if (!finished) await cp.finish(THREW_RESULT);
    }
  }

  // Page fixture (spec 2026-10-15-browse-fixture-design.md): the package's
  // createFixtureSetup owns apply + release (incl. a late apply after abort).
  // Never `url` together with `setup`: the fixture carries the start URL.
  const setPhase = (phase: "setup" | "running") => {
    if (toolCallId) useBrowseAgentPhaseStore.getState().setPhase(toolCallId, phase);
  };
  let parsed: ReturnType<typeof parsePageFixture>;
  if (hasResume) {
    // `resume` is a checkpoint id of THIS chat; it replaces url and setup.
    if (!checkpointChat) {
      parsed = { ok: false, error: "checkpoints need a chat" };
    } else if (hasSetup || url) {
      parsed = { ok: false, error: "resume cannot be combined with url or setup: the checkpoint carries the page" };
    } else if (resumeId === "") {
      parsed = { ok: false, error: "resume must be a checkpoint id such as cp_1" };
    } else {
      const entry = useBrowseCheckpointStore.getState().get(checkpointChat, resumeId);
      if (!entry) {
        parsed = {
          ok: false,
          error: `checkpoint ${resumeId} not found — older checkpoints are dropped when newer ones arrive, and all checkpoints are lost when the editor reloads; start again with url or setup`,
        };
      } else if (entry.isolated && !runSession) {
        parsed = {
          ok: false,
          error: `checkpoint ${resumeId} was recorded in an isolated QA run and can be resumed only by another QA run (qa: true); for a plain task, start again with url or setup`,
        };
      } else {
        parsed = parsePageFixture({ ...entry.fixture, ...(entry.network ? { network: entry.network } : {}) });
      }
    }
  } else {
    // The tool's `url` is the only start URL; the model-supplied `version` and
    // `url` inside `setup` never win.
    parsed =
      typeof setup === "object" && !Array.isArray(setup)
        ? parsePageFixture({
            ...(({ url: _ignored, ...rest }) => rest)(setup as Record<string, unknown>),
            version: 1,
            ...(url ? { url } : {}),
          })
        : { ok: false, error: "setup must be an object" };
  }
  if (parsed.ok) network = parsed.value.network;
  // The validated fixture (a resumed checkpoint's too) is what the exported test must set up.
  if (parsed.ok) traceRecorder?.setRepro({ setup: parsed.value });
  let setupApplied = false;
  const fs = parsed.ok
    ? createFixtureSetup(bridge ?? INERT_BRIDGE, parsed.value, {
        allowNetworkMocks: true,
        snapshot: () =>
          executeToolCall(
            "browse_snapshot",
            {},
            { sessionId: parentSessionId, ...browserContext, toolCallId: `${toolCallId ?? "browse_agent"}:setup`, signal: context?.signal },
            "browse_agent",
          ),
        // Not called after fs.release(), so a late apply never flips the phase.
        onApplied: () => {
          setupApplied = true;
          setPhase("running");
        },
      })
    : undefined;
  readMockHits = () => fs?.mockHits();
  setPhase("setup");
  const cp = openCheckpoint(parsed.ok);
  const releaseFixture = async () => void (await fs?.release());
  try {
    await cp.begin();
    const result = await session.run(goal, driver, {
      toolCallId,
      setup:
        fs?.setup ??
        (async () => {
          throw new SetupError("validate", parsed.ok ? "" : parsed.error);
        }),
    });
    await finishTraceCapture(result);
    const qa = await buildQa(result);
    const settleJudge = await startJudge(qa);
    const checkpoint = await finishCheckpoint(cp, result, releaseFixture);
    return finishJson(result, setupApplied ? { setupApplied: true } : {}, checkpoint, qa, settleJudge);
  } finally {
    // On the normal path finishCheckpoint already ran. Otherwise (a throw) this
    // still releases the fixture (before the journal stop) and stops the journal.
    // The mocks live until the task ends, whatever the outcome.
    if (!finished) await cp.finish(THREW_RESULT, { beforeStop: releaseFixture });
    if (toolCallId) useBrowseAgentPhaseStore.getState().clearPhase(toolCallId);
  }
};
