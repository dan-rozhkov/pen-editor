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
  createRunCheckpoint,
  singleUseTool,
  QA_VERDICT_TOOL,
  QA_VERDICT_FIELD,
  qaVerdictHooks,
  executeQaVerdict,
  qaResultOf,
  createStepRecorder,
  QA_ASSERT_TOOL,
  QA_FINAL_CHECKS_TIMEOUT_MS,
  executeQaAssert,
  runFinalChecks,
  applyFinalChecks,
  finalChecksApply,
  parseQaChecks,
  type QaCheck,
  type BrowseAgentResult,
} from "@sideform/browser-agent/agent/session";
import { parsePageFixture, type FixtureNetworkRule } from "@sideform/browser-agent/fixture";
import { Chat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { getRequestUserId } from "@/lib/auth/authState";
import { createChatTransport, CLIENT_CAPABILITIES } from "@/lib/chatTransport";
import type { ToolHandler } from "../../toolRegistry";
import { CLOSE_SESSION_TIMEOUT_MS, closeBrowserSession, getBrowserBridge, isDesktopBrowserAvailable, type BrowserBridge } from "./bridge";
import { isIsolatedQaCall, runSessionId } from "./isolation";
import { acquireBrowseSlot } from "@/lib/browseRunLimiter";
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
): Promise<string> {
  const fail = (message: string) => JSON.stringify({ error: `${QA_ASSERT_TOOL}: ${message}` });
  if (signal.aborted) return fail("aborted.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      executeQaAssert(input, bridge, recorder),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(fail("timed out.")), QA_FINAL_CHECKS_TIMEOUT_MS);
        onAbort = () => resolve(fail("aborted."));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
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
  if (!isIsolatedQaCall(args)) return runBrowseAgent(args, context, undefined, undefined);
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
    const deadlineMs =
      BROWSE_AGENT_DEADLINE_MS - (Date.now() - waitStart) - CHECKPOINT_CALL_TIMEOUT_MS - CLOSE_SESSION_TIMEOUT_MS - checksReserve;
    if (deadlineMs < MIN_ISOLATED_RUN_MS) {
      return JSON.stringify({
        status: "error",
        steps: 0,
        error: "Waited too long for a free parallel browser slot to run this scenario; call it again.",
      });
    }
    const runSession = runSessionId(context?.sessionId, context?.toolCallId);
    try {
      return await runBrowseAgent(args, context, runSession, deadlineMs);
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

/** Below this much deadline left after waiting for a slot, an isolated run is not worth starting. */
const MIN_ISOLATED_RUN_MS = 60_000;

const runBrowseAgent = async (
  args: Record<string, unknown>,
  context: Parameters<ToolHandler>[1],
  runSession: string | undefined,
  deadlineMs: number | undefined,
): Promise<string> => {
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  if (!goal) return JSON.stringify(goalRequiredResult());
  const url = typeof args.url === "string" ? args.url.trim() : "";
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
      try {
        end = recorder?.onToolCall(call);
      } catch {
        // An observer must not change the run.
      }
      try {
        const output =
          qaOn && call.toolName === QA_VERDICT_TOOL
            ? executeQaVerdict(call.input)
            : qaOn && recorder && assertAllowed && call.toolName === QA_ASSERT_TOOL
              ? await boundedQaAssert(call.input, bridge ?? INERT_BRIDGE, recorder, signal)
              : await executeToolCall(
                call.toolName,
                call.input,
                { sessionId: parentSessionId, ...browserContext, toolCallId: call.toolCallId, signal },
                "browse_agent",
              );
        end?.({ output });
        return output;
      } catch (err) {
        end?.({ error: err });
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
        clientCapabilities: { ...CLIENT_CAPABILITIES, browseAssert: assertAllowed },
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
  const buildQa = async (result: BrowseAgentResult) => {
    if (!recorder) return undefined;
    let qa = qaResultOf(result, recorder.steps(), recorder.extras());
    if (finalChecks && finalChecksApply(qa)) {
      const finalResults = await runFinalChecks(bridge ?? INERT_BRIDGE, finalChecks, recorder);
      // The final assert drained more errors into the recorder: refresh the run-level lists.
      qa = applyFinalChecks({ ...qa, ...recorder.extras() }, finalResults);
    }
    return qa;
  };
  const toJson = (result: BrowseAgentResult, extra: Record<string, unknown>, checkpoint: unknown, qa: Awaited<ReturnType<typeof buildQa>>): string => {
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

  if (!hasSetup && !hasResume) {
    const cp = openCheckpoint(true);
    try {
      await cp.begin();
      const result = await session.run(goal, driver, { url: url || undefined, toolCallId });
      const qa = await buildQa(result);
      return toJson(result, {}, await finishCheckpoint(cp, result), qa);
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
    const qa = await buildQa(result);
    return toJson(result, setupApplied ? { setupApplied: true } : {}, await finishCheckpoint(cp, result, releaseFixture), qa);
  } finally {
    // On the normal path finishCheckpoint already ran. Otherwise (a throw) this
    // still releases the fixture (before the journal stop) and stops the journal.
    // The mocks live until the task ends, whatever the outcome.
    if (!finished) await cp.finish(THREW_RESULT, { beforeStop: releaseFixture });
    if (toolCallId) useBrowseAgentPhaseStore.getState().clearPhase(toolCallId);
  }
};
