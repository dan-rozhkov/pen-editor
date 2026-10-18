import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { createToolExecutor, type ToolExecutedEvent } from "@sideform/agent-harness/executor";
import type { RetryState } from "@sideform/agent-harness/retry-fetch";
import { browseTaskInnerBoundMs } from "@sideform/browser-agent/loop";
import { track, bucketLength } from "@/lib/analytics";
import { getLikedReferences } from "@/lib/canvasLink/likedReferences";
import { consumeFirstPromptTiming } from "@/lib/analytics/sessionTiming";
import { isOffline, OFFLINE_MESSAGE } from "@/lib/apiBase";
import { getRequestUserId } from "@/lib/auth/authState";
import { createChatTransport, resolveChatApiUrl, CLIENT_CAPABILITIES } from "@/lib/chatTransport";
import { resolveSessionModel } from "@/lib/sessionModel";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { buildSceneContext } from "@/lib/canvasLink/sceneContext";
import { useChatStore, NO_QUEUED_MESSAGES } from "@/store/chatStore";
import { toolHandlers, type ToolExecutionContext, type ToolHandler } from "@/lib/toolRegistry";
import { runToolCall } from "@/lib/toolCallQueue";
import { runTasteCheckForToolCall } from "@/lib/tools/tasteCheck";
import { hasTouchedEmbeds } from "@/lib/tools/tasteCheckRegistry";
import type { ChatLaunchPayload } from "@/types/chat";
import type { UIMessage } from "ai";
import { hasPendingAskUser } from "@/components/chat/pendingAskUser";
import { setCloudBrowserChat } from "@/lib/cloudBrowser";
import { isDesktopBrowserAvailable } from "@/lib/tools/browser/bridge";
import { isIsolatedQaCall } from "@/lib/tools/browser/isolation";
import { BROWSE_AGENT_OUTER_TIMEOUT_MS } from "@/lib/tools/browser/browseAgent";
import { extractStreamingToolInputs } from "@/hooks/streamingToolParts";
import {
  panelCallTool,
  panelEndStream,
  panelForwardFrame,
  panelRunsInCanvas,
  withPanelCanvasContext,
} from "@/lib/canvasLink/panelRuntime";
import {
  streamingToolAdapters,
  streamingToolNames,
  getStreamingToolAdapter,
} from "@/lib/streamingTools";

const STREAM_RENDER_THROTTLE_MS = 50;

// Re-exported for tests (the implementation lives in lib/chatTransport.ts).
export { resolveChatApiUrl };

// Re-exported for tests (the implementation lives in lib/sessionModel.ts: the canvas link needs the
// same resolution and must not import this hook module).
export { resolveSessionModel };

// Exported for tests.
export function buildCanvasContext(sessionId?: string): object {
  const model = resolveSessionModel(sessionId);
  const scene = buildSceneContext({ model });

  const likedReferences = getLikedReferences(sessionId);

  return {
    canvasContext: JSON.stringify({
      ...scene,
      // Reference images the user hearted in this chat; the agent should
      // prefer them. Omitted when empty so canvasContext stays byte-identical
      // (prompt-cache invariant). Appended last for the same reason.
      ...(likedReferences.length > 0 ? { likedReferences } : {}),
    }),
    model,
    userId: getRequestUserId(),
    clientCapabilities: CLIENT_CAPABILITIES,
  };
}

// Default budget for a tool call before we give up and report a timeout to
// the model. Per-tool overrides live in TOOL_CALL_TIMEOUT_MS_OVERRIDES below.
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 30_000;

// Image generation can legitimately run close to the backend's own ceiling
// (IMAGE_GENERATION_TIMEOUT_MS = 90_000 in pen-editor-backend/src/config.ts).
// 95s is deliberately just above that: it lets the backend's clean 504 win
// the race instead of this client cutting the call off first and reporting
// a misleading "Tool call timed out" while the server keeps working (and
// paying for it) in the background.
/** Margin the chat-side browse_task timeout keeps above the loop's own
 * bound (`browseTaskInnerBoundMs`, the REAL bound on the call). */
const BROWSE_TASK_OUTER_MARGIN_MS = 60_000;

const TOOL_CALL_TIMEOUT_MS_OVERRIDES: Record<string, number> = {
  generate_image: 95_000,
  generate_frame_image: 95_000,
  // remove-background/vectorize call out to their own upstream provider and
  // can run well past the default budget; 60s is generous headroom without
  // matching generate_image's 95s (these aren't racing a comparable backend
  // ceiling documented anywhere yet).
  remove_background: 60_000,
  // open_canvas_tab can open a new tab in the desktop shell and waits for it to register: a cold
  // load is far slower than a scene mutation.
  open_canvas_tab: 60_000,
  vectorize_image: 60_000,
  // browse_task (docs/superpowers/specs/2026-09-18-browse-task-jev-loop-
  // design.md §3) runs a whole snapshot/step/perform loop internally bounded
  // by its own BROWSE_TASK_DEADLINE_MS = 90_000. That would not fit under
  // the 30s default — this client-side timeout would fire and report a
  // misleading "Tool call timed out" while the loop kept running underneath
  // it.
  //
  // Finding: 100s wasn't enough margin over the loop's own worst case. The
  // loop's STEP_DEADLINE_RESERVE_MS (@sideform/browser-agent loop) only guarantees a step
  // won't START once fewer than 35s remain of the 90s internal deadline —
  // an already-started step can still take up to ~61.5s (snapshot + the
  // /api/browse/step round trip + the act/perform call itself, see that
  // constant's own comment), so the loop can finish as late as
  // 90 - 35 + 61.5 = 116.5s after it starts. 150s covers that worst case
  // with real margin, without needing to also raise the loop's own
  // BROWSE_TASK_DEADLINE_MS (see STEP_DEADLINE_RESERVE_MS's comment for why
  // that constant didn't need to move too).
  //
  // Multi-sub-goal calls (@sideform/browser-agent runBrowseTask) are bounded by
  // MULTI_SUBGOAL_DEADLINE_MS = 12 min overall, with every sub-goal's loop
  // deadline clamped to what is left of it. Same reasoning as above: the
  // last loop can end at 720 - 35 + 61.5 = 746.5s, so 780s (13 min) covers
  // it and the <=15s planning call, which runs inside the overall budget.
  // Plus settleEmptySnapshot's worst case at a sub-goal's first step
  // (@sideform/browser-agent loop, BROWSE_SETTLE_WORST_CASE_MS = 12 * (400ms + 20s snapshot)
  // = 244.8s, only on a page that stays blank): 746.5 + 244.8 = 991.3s.
  // The real bound is the handler's own internal race
  // (browseTaskInnerBoundMs() = 720 + 35 + 244.8 = 999.8s, which returns a
  // `budget` transcript and aborts the loop); this outer value is just 60s
  // above it. One value serves single- and multi-sub-goal calls (not known
  // up front).
  browse_task: browseTaskInnerBoundMs(false) + BROWSE_TASK_OUTER_MARGIN_MS,
  // browse_agent runs a whole nested chat (<= 60 model requests, each with
  // its own browse_* calls and their own timeouts). The same value applies on
  // desktop and cloud: the nested calls carry their own cloud headroom.
  browse_agent: BROWSE_AGENT_OUTER_TIMEOUT_MS,
  // browse_open (docs/superpowers/specs/2026-09-18-builtin-browser-design.md
  // §5) reuses the desktop's own BROWSER_OPEN_TIMEOUT_MS = 45_000 navigation
  // budget, and — since browse-speed-contract.md's "Frontend" item 2 — also
  // takes an extra browser.snapshot() call afterward (up to the desktop's
  // 20s BROWSER_COMMAND_TIMEOUT_MS) to attach a fresh `snapshot`. 45 + 20 =
  // 65s worst case; 70s covers that with margin, comfortably above the
  // contract's "≥ 50s" floor.
  browse_open: 70_000,
  // browse_act (docs/superpowers/specs/2026-09-23-full-browser-use-design.md,
  // "act gains actions and index targeting"; browse-speed-contract.md's
  // "Frontend" item 1 adds a 1..10-entry `actions` batch). Three worst
  // cases, and this must cover all of them:
  //   - Plain act (index/target, no `element`): the desktop shell's own
  //     BROWSER_COMMAND_TIMEOUT_MS = 20s bounds every command, including
  //     `wait`'s hard cap of 15s (`wait` polls WITHIN that same 20s command
  //     budget, not on top of it). 15s + 5s margin lands on that same 20s —
  //     this override must be at least that.
  //   - The `element` natural-language targeting path (same design doc's
  //     follow-up) does three things in sequence before the model sees a
  //     result: (1) browser.snapshot() — up to the desktop's 20s command
  //     budget; (2) an /api/browse/locate round trip — bounded by shared.ts's
  //     BROWSE_BACKEND_REQUEST_TIMEOUT_MS = 20s, which (per shared.ts's
  //     fetchBrowseBackend) now covers the response body read too, not just
  //     the fetch; (3) the act command itself — the desktop's 20s command
  //     budget plus its ~1.5s cursor-move budget (CURSOR_TIMEOUT_MS in
  //     pen-editor-desktop/src/main/browser/controller.ts) for a
  //     click/type/select/hover/press that moves the visible cursor first.
  //     20 + 20 + 21.5 = 61.5s worst case. 65s used to cover this alone.
  //   - An `actions` batch: up to 10 entries, each individually as expensive
  //     as the plain-act worst case above (~21.5s for a cursor-moving act),
  //     plus one more snapshot at the end for the batch-level `snapshot`
  //     field. 65s stopped being enough the moment batching landed — the
  //     contract calls for raising this override to 120s rather than trying
  //     to size it for the full 10×21.5s+20s ≈ 235s worst case, since that
  //     would make one runaway batch dominate the whole tool-call budget;
  //     120s is a deliberate compromise, not a hard cap derived from the
  //     batch math.
  // Finding: at 120s, that compromise wasn't actually being enforced —
  // runActionsBatch's own internal BATCH_DEADLINE_MS was 100s, which left
  // only ~20s of margin against a single entry's own ~61.5s worst case (an
  // entry starting at t=99s could finish around t=160s). BATCH_DEADLINE_MS
  // is now tightened to 60s (BATCH_DEADLINE_MS in
  // @sideform/browser-agent/agent/execute, run by its runActionsBatch), and the trailing snapshot
  // call is skipped once that internal deadline has passed, so this 120s
  // client-side budget stays a real ceiling rather than an aspirational one.
  browse_act: 120_000,
  // browse_tabs (same design doc) with `action: "new"` and a `url` reuses
  // browse_open's ~65s worst case (see browse_open's override above), so it
  // needs the same headroom as browse_open — 70s leaves margin above that.
  browse_tabs: 70_000,
  // browse_capture serializes the whole DOM (and, on cloud, ships up to ~3 MB of
  // HTML back). The desktop command budget is 20s; 60s sits well above it, and
  // cloud mode adds its usual +60s.
  browse_capture: 60_000,
  // browse_fill_login: the desktop chains a snapshot, 2x TYPE_TEXT and an
  // optional press, each bounded by the 20s command budget (cursor-move
  // budget included). Like browse_act's reasoning, worst case is a few
  // sequential 20s commands; 90s leaves margin without being unbounded.
  browse_fill_login: 90_000,
  // generate_vector hands the prompt to QuiverAI's arrow-2, which draws the
  // SVG token by token: measured 20s for a simple icon and ~90s for a
  // detailed illustration, against the backend's own QUIVER_TIMEOUT_MS =
  // 180_000. At the 30s default this fired on almost every real call — the
  // model was told the generation "timed out" and retried it, paying twice,
  // while the first generation had in fact finished and committed its nodes
  // to the canvas. 185s sits just above the backend ceiling so the server's
  // clean 504 wins the race, same reasoning as generate_image above.
  generate_vector: 185_000,
};

// Cloud mode (no `window.penDesktop.browser`): the desktop values are sized
// for local IPC. A cold cloud command can additionally spend a Steel session
// create (<=20s) and a CDP connect (<=30s) before the command itself, so
// browse_open (45s nav + those 50s + snapshot) gets 150s and every other
// browse_* gets its desktop budget + 60s. Desktop values stay unchanged.
const CLOUD_BROWSE_OPEN_TIMEOUT_MS = 150_000;
const CLOUD_BROWSE_EXTRA_MS = 60_000;
// browse_task's cloud call is bounded by CLOUD_MULTI_SUBGOAL_DEADLINE_MS
// (15 min, @sideform/browser-agent loop; a single sub-goal loop runs
// CLOUD_BROWSE_TASK_DEADLINE_MS = 180s, clamped to what is left of it):
// 900 - 35 + 61.5 = 926.5s worst case after it starts, plus the cold
// session create/connect above (<=50s) and settleEmptySnapshot's worst case
// (244.8s, see browse_task above) — 1221.3s worst case. The real bound is
// the handler's internal race (browseTaskInnerBoundMs() = 900 + 35 + 244.8 =
// 1179.8s, cold session included since it runs inside the call); this outer
// value is 60s above it.
const CLOUD_BROWSE_TASK_TIMEOUT_MS = browseTaskInnerBoundMs(true) + BROWSE_TASK_OUTER_MARGIN_MS;

export function getToolCallTimeoutMs(toolName: string): number {
  const base = TOOL_CALL_TIMEOUT_MS_OVERRIDES[toolName] ?? DEFAULT_TOOL_CALL_TIMEOUT_MS;
  if (toolName === "browse_agent") return base;
  if (!toolName.startsWith("browse_") || isDesktopBrowserAvailable()) return base;
  if (toolName === "browse_open") return CLOUD_BROWSE_OPEN_TIMEOUT_MS;
  if (toolName === "browse_task") return CLOUD_BROWSE_TASK_TIMEOUT_MS;
  return base + CLOUD_BROWSE_EXTRA_MS;
}

// The finished message's `metadata` is typed `unknown` (useChat isn't given
// a messageMetadataSchema) — this is the sole place that trusts its shape.
// `contextTokens` is the backend's actual input-token count for the turn's
// last step (see chat.ts's `finish` chunk); a non-positive or missing value
// means "nothing to report" rather than a real reading of zero context use.
// Exported for tests.
export function extractContextTokens(metadata: unknown): number | undefined {
  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }
  const { contextTokens } = metadata as { contextTokens?: unknown };
  return typeof contextTokens === "number" && contextTokens > 0
    ? contextTokens
    : undefined;
}

// Exported for tests. `source` distinguishes the chat UI path from the MCP
// WebSocket/desktop IPC bridge paths (`src/lib/mcpDispatch.ts`), which all
// funnel through this single choke point but can't otherwise be told apart
// from inside it — callers must say which they are. Defaults to "bridge"
// since `onToolCall` below is the one call site that passes "chat"
// explicitly; every other caller is a bridge.
//
// The generic mechanics (serialization, timeout race, signal merging, error
// shaping) live in @sideform/agent-harness; only the app policy is here.
//
// Serialized at the funnel, rather than at each call site: chat, both MCP
// bridges and the WebMCP surface all arrive through here, so "two agents
// cannot interleave scene mutations" is true by construction. Read-only tools
// are not queued (see toolCallQueue.ts). The timeout starts inside the queued
// task so a call that waited behind a long batch_design still gets its full
// budget.
type ToolCallSource = "chat" | "bridge" | "webmcp" | "browse_agent" | "canvas-link";

function trackToolExecuted(event: ToolExecutedEvent<ToolCallSource>): void {
  track("agent_tool_executed", {
    tool_name: event.toolName,
    ok: event.ok,
    duration_ms: event.durationMs,
    ...(event.errorKind ? { error_kind: event.errorKind } : {}),
    source: event.source,
  });
}

const CANCELLED_RESULT = JSON.stringify({ error: "Tool call cancelled" });

// Checked inside the queued task (the harness invokes the handler there), so a
// call cancelled or timed out by its caller while it waited behind a long batch
// never runs and never mutates anything.
const withAbortedCheck =
  (handler: ToolHandler | undefined): ToolHandler | undefined =>
  handler &&
  ((args, ctx) => {
    if (ctx?.signal?.aborted) return Promise.resolve(CANCELLED_RESULT);
    try {
      ctx?.onStart?.();
    } catch {
      // An observer must not stop the handler.
    }
    return handler(args, ctx);
  });

function buildToolExecutor(timeoutMs: (toolName: string) => number) {
  return createToolExecutor<ToolExecutionContext, ToolCallSource>({
    resolveHandler: (toolName) => withAbortedCheck(toolHandlers[toolName]),
    runQueued: runToolCall,
    timeoutMs,
    onExecuted: trackToolExecuted,
  });
}

const executeWithHarness = buildToolExecutor((toolName) => getToolCallTimeoutMs(toolName));

export interface ExecuteToolCallOptions {
  /** Per-call budget replacing the tool's default (counted from the start of the queued task). */
  timeoutMs?: number;
}

// @sideform/agent-harness's `timeoutMs(toolName, input)` does not receive the
// execution context, so a per-call budget cannot ride in `ctx`. Instead one
// executor per distinct budget is cached (the canvas link sends the handful of
// per-tool budgets, never a fresh number per call). Harness follow-up: pass
// `ctx` to `timeoutMs`, then this map can go.
const MAX_BUDGET_EXECUTORS = 32;
const budgetExecutors = new Map<number, ReturnType<typeof buildToolExecutor>>();

function executorForBudget(budget: number): ReturnType<typeof buildToolExecutor> {
  let executor = budgetExecutors.get(budget);
  if (!executor) {
    executor = buildToolExecutor(() => budget);
    if (budgetExecutors.size < MAX_BUDGET_EXECUTORS) budgetExecutors.set(budget, executor);
  }
  return executor;
}

export function executeToolCall(
  toolName: string,
  input: unknown,
  context?: ToolExecutionContext,
  source: ToolCallSource = "bridge",
  options?: ExecuteToolCallOptions
): Promise<string> {
  const budget = options?.timeoutMs;
  if (typeof budget === "number" && Number.isFinite(budget) && budget > 0) {
    return executorForBudget(budget)(toolName, input, context, source);
  }
  return executeWithHarness(toolName, input, context, source);
}

// Exported for tests. Joins the text parts of the LAST user-role message in
// `messages` — this is the `brief` handed to a Jev taste check
// (tasteCheck.ts truncates it to 4000 chars itself), so the check has some
// idea what the user actually asked for. Returns undefined for a history
// with no user message yet (shouldn't happen once a tool call exists, but
// cheap to guard).
export function getLastUserMessageText(messages: UIMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    return text || undefined;
  }
  return undefined;
}

interface UseDesignChatOptions {
  sessionId: string;
}

function cloneLaunchPayload(payload: ChatLaunchPayload): ChatLaunchPayload {
  return {
    text: payload.text,
    images: payload.images?.map((image) => ({ ...image })),
  };
}

// One instance: the offline error carries no per-attempt information, and a
// stable identity keeps it from re-rendering consumers that memo on `error`.
const OFFLINE_SEND_ERROR = new Error(OFFLINE_MESSAGE);

// A live isolated QA run: its tool call is answered later (not awaited in
// onToolCall). `settle(output)` answers it once; `settle(null)` forgets it
// without writing (its tool part is gone). Later calls are ignored.
interface LiveRun {
  controller: AbortController;
  settle: (output: string | null) => void;
}

const ABORTED_RUN_OUTPUT = JSON.stringify({ status: "aborted", steps: 0 });

export function useDesignChat({ sessionId }: UseDesignChatOptions) {
  const [input, setInput] = useState("");
  // Fallback chat for cloud-browser calls that carry no chat context; the
  // browse_* handlers bind to their own session id when they have one.
  useEffect(() => {
    setCloudBrowserChat(sessionId);
  }, [sessionId]);
  // Set when a send is refused because the browser is offline. The error
  // itself is DERIVED from this plus live connectivity (see `offlineError`
  // below) rather than stored: an "you are offline" banner is stale the
  // moment the connection is back, so nothing has to clear it — in
  // particular the queued-message drain effect doesn't, which is what keeps
  // that effect free of setState.
  const [offlineSendRefused, setOfflineSendRefused] = useState(false);

  // Non-null while the transport is auto-retrying a network failure; drives
  // the neutral "retrying…" status line instead of the red error banner.
  const [retryState, setRetryState] = useState<RetryState | null>(null);

  const transport = useMemo(
    () =>
      createChatTransport({
        // Agent panel: the canvas tab's context (async; the SDK awaits `body`).
        body: () => withPanelCanvasContext(sessionId, buildCanvasContext(sessionId)),
        onRetryStateChange: setRetryState,
      }),
    // Built once per mounted session: the model (and everything else in the
    // body) is read fresh from the stores on every send, keyed by this
    // session's own id.
    [sessionId]
  );

  const setContextTokens = useChatStore((s) => s.setContextTokens);

  // True from a terminal-abandonment path (`clearStreamingToolSession`: user
  // Stop, external abort, failed request, unmount) until the next request
  // starts (the "submitted" effect below resets it). `Chat.stop()` settles
  // `status` to "ready" while `onToolCall` may still be awaiting a Jev taste
  // check, and the `addToolOutput` it then issues would otherwise satisfy
  // `sendAutomaticallyWhen` and resume the turn the user just stopped. The
  // output itself must still be written (an `input-available` part with no
  // output makes every later request fail with MissingToolResultsError), so
  // the gate is on the auto-send, not on `addToolOutput`.
  const turnStoppedRef = useRef(false);

  // Isolated QA browse_agent runs started by this session and not yet settled.
  // Their onToolCall returns at once (like ask_user) so several run together,
  // which lets the stream finish and `chat.status` read "ready" while they work.
  // The count keeps the session reading as busy: status/isLoading, Send (queues)
  // and the queue drain all key off it, or a new request would go out with
  // unresolved tool parts. Auto-continuation needs no gate: the SDK sends once
  // every tool call of the step has an output (addToolOutput below).
  // The ONE source of "tool work is open": toolCallId -> abort of each live run.
  // `parallelBrowseRuns` mirrors its size for rendering; callbacks read the ref.
  const livePendingRunsRef = useRef<Map<string, LiveRun>>(new Map());
  const [parallelBrowseRuns, setParallelBrowseRuns] = useState(0);

  const chat = useChat({
    id: sessionId,
    transport,
    // AI SDK otherwise publishes a React update for every stream chunk. A
    // short throttle keeps active Markdown rendering responsive while still
    // feeling continuous, especially when multiple sessions run in parallel.
    experimental_throttle: STREAM_RENDER_THROTTLE_MS,
    sendAutomaticallyWhen: (options) =>
      !turnStoppedRef.current && lastAssistantMessageIsCompleteWithToolCalls(options),
    // Feeds ContextMeter (components/chat/ContextMeter.tsx). This session's
    // OWN id, not the active chat — a background session finishing a turn
    // must update its own reading, never whatever chat the user happens to
    // be looking at (same reasoning as resolveSessionModel above).
    onFinish: ({ message }) => {
      const contextTokens = extractContextTokens(message.metadata);
      if (contextTokens !== undefined) {
        setContextTokens(sessionId, contextTokens);
      }
    },
    onToolCall: async ({ toolCall }) => {
      // ask_user is answered by the in-chat form (AskUserForm), which calls
      // addToolOutput on submit. Leaving the part unresolved keeps the turn
      // paused (sendAutomaticallyWhen only fires once every tool call has an
      // output), which is exactly the desired human-in-the-loop behavior.
      if (toolCall.toolName === "ask_user") {
        return;
      }
      // Isolated QA runs: start, do not await. Everything else stays awaited.
      if (toolCall.toolName === "browse_agent" && isIsolatedQaCall((toolCall.input ?? {}) as Record<string, unknown>)) {
        startParallelBrowseRun(toolCall);
        return;
      }
      // Every tool call gets the turn's abort signal (browse_task runs for
      // minutes): every terminal-abandonment path (user Stop, external abort,
      // failed request, unmount — all via clearStreamingToolSession) aborts
      // it. Created already aborted if the turn was stopped meanwhile.
      const toolAbort = new AbortController();
      if (turnStoppedRef.current) toolAbort.abort();
      pendingToolCallAbortsRef.current.add(toolAbort);
      let handlerResult: string;
      try {
        // Agent panel: canvas tools run in the bound canvas tab.
        if (panelRunsInCanvas(toolCall.toolName)) {
          // Analytics: the canvas tab's executeToolCall is the one event; the panel
          // client reports only failures that never reached it (panelRuntime).
          handlerResult = await panelCallTool(sessionId, toolCall.toolName, toolCall.input, {
            toolCallId: toolCall.toolCallId,
            timeoutMs: getToolCallTimeoutMs(toolCall.toolName),
            signal: toolAbort.signal,
          });
        } else {
          handlerResult = await executeToolCall(
            toolCall.toolName,
            toolCall.input,
            { sessionId, toolCallId: toolCall.toolCallId, signal: toolAbort.signal },
            "chat"
          );
        }
      } finally {
        pendingToolCallAbortsRef.current.delete(toolAbort);
      }
      let output = handlerResult;
      // Jev taste check (src/lib/tools/tasteCheck.ts): a no-op for every
      // tool except batch_design/edit_embed_html, and even for those two
      // only when the handler above actually recorded a touched embed
      // (tasteCheckRegistry.ts) — `hasTouchedEmbeds` peeks that synchronously
      // so every other call skips this block without paying for
      // `getLastUserMessageText` or a registry round-trip.
      //
      // AWAITED, deliberately (unlike an earlier version of this feature
      // that fired-and-forgot this call): `onToolCall`'s return is what the
      // AI SDK's stream reader awaits before it can process the turn's next
      // chunk (node_modules/ai/dist/index.mjs, `case
      // "tool-input-available"`), so keeping this call in that await chain
      // is what keeps `chat.status` at "streaming" for as long as the check
      // takes (bounded by its own internal timeout). That in turn is what
      // the queue-drain effect / Send / Rollback / Clear chat all key off to
      // tell "turn in flight" apart from "turn done" — a detached check
      // whose output arrived after `status` had already gone "ready" used to
      // let all of those act on a turn that still had an unresolved tool
      // part, and (via `sendAutomaticallyWhen`) risked silently resuming a
      // turn the user had already stopped.
      //
      // Never allowed to throw: the taste check itself is fail-open by
      // design (tasteCheck.ts's doc comment), but this try/catch is a second
      // line of defense — `handlerResult`, the tool's real, already-
      // committed result, must reach `chat.addToolOutput` even if something
      // here misbehaves.
      // `turnStoppedRef`: a Stop that landed while the handler itself was
      // still running (e.g. queued behind other mutations) happened before
      // any controller existed to abort, so don't start a check at all.
      //
      // Agent panel: NOT run for canvas-link calls. The handler ran in the canvas
      // tab, so the touched-embed registry this check reads was filled in that
      // process, not here: `hasTouchedEmbeds` is always false below. Known
      // limitation (CLAUDE.md, "Canvas link — panel side"); a cross-process
      // taste check is a follow-up.
      if (
        (toolCall.toolName === "batch_design" || toolCall.toolName === "edit_embed_html") &&
        !turnStoppedRef.current &&
        hasTouchedEmbeds(toolCall.toolCallId)
      ) {
        const controller = new AbortController();
        pendingTasteCheckAbortsRef.current.add(controller);
        try {
          output = await runTasteCheckForToolCall(
            toolCall.toolName,
            toolCall.toolCallId,
            handlerResult,
            { brief: getLastUserMessageText(chat.messages) },
            controller.signal,
          );
        } catch {
          output = handlerResult;
        } finally {
          pendingTasteCheckAbortsRef.current.delete(controller);
        }
      }
      chat.addToolOutput({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output,
      });
      // Record that this streaming-tool call's handler actually ran (see
      // `completedStreamingCallKeysRef` below) — the "ready" sweep effect
      // uses this, not part state, to tell "handler resolved" apart from
      // "handler never got to run". `completedStreamingCallKeysRef` is
      // declared further down in this function body, but that's fine: this
      // closure isn't invoked until the AI SDK calls back into it, by which
      // time every hook in this render has already run and the ref exists.
      if (streamingToolNames.has(toolCall.toolName)) {
        completedStreamingCallKeysRef.current.add(
          streamingToolKey(toolCall.toolName, toolCall.toolCallId)
        );
      }
    },
  });

  // Same timeout / error handling as the awaited path (executeToolCall owns
  // both). The output is ALWAYS written, even after Stop (an input-available
  // part with no output poisons later requests): Stop and Clear chat answer it
  // "aborted" at once (see LiveRun). The concurrency cap lives in the browse_agent
  // handler (browseAgent.ts), so a run waiting for a slot sits inside executeToolCall.
  function startParallelBrowseRun(toolCall: { toolName: string; toolCallId: string; input: unknown }): void {
    const toolAbort = new AbortController();
    if (turnStoppedRef.current) toolAbort.abort();
    const id = toolCall.toolCallId;
    let settled = false;
    const settle = (output: string | null) => {
      if (settled) return;
      settled = true;
      void (async () => {
        try {
          // Awaited: the run stays "live" until the message update has landed, so
          // busy never reads false while the part still lacks its output.
          if (output !== null) await chat.addToolOutput({ tool: toolCall.toolName, toolCallId: id, output });
        } catch {
          // The transcript was cleared or replaced meanwhile: nothing to write to.
        } finally {
          livePendingRunsRef.current.delete(id);
          setParallelBrowseRuns(livePendingRunsRef.current.size);
        }
      })();
    };
    livePendingRunsRef.current.set(id, { controller: toolAbort, settle });
    setParallelBrowseRuns(livePendingRunsRef.current.size);
    void executeToolCall(toolCall.toolName, toolCall.input, { sessionId, toolCallId: id, signal: toolAbort.signal }, "chat")
      .catch((err: unknown) => JSON.stringify({ error: err instanceof Error ? err.message : "Tool call failed" }))
      .then(settle);
  }

  // `setMessages` that drops the tool call of a live run (Clear chat, rollback)
  // aborts that run and forgets it: its output has nowhere to go. Handles the
  // updater form too (the next list is computed first).
  const { setMessages: setChatMessages } = chat;
  const setMessages = useCallback(
    (update: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])): void => {
      // The SDK's own latest state feeds the updater; the abort is a side effect
      // of computing the next list (idempotent, so a repeated call is harmless).
      setChatMessages((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        if (livePendingRunsRef.current.size > 0) {
          const kept = new Set<string>();
          for (const m of next) for (const p of m.parts) if ("toolCallId" in p) kept.add(String(p.toolCallId));
          for (const [id, run] of [...livePendingRunsRef.current]) {
            if (kept.has(id)) continue;
            run.controller.abort();
            run.settle(null);
          }
        }
        return next;
      });
    },
    [setChatMessages]
  );

  // Drives re-running the queued-payload effect below once connectivity
  // returns (see the effect for why offline must not consume the queue).
  const isOnline = useOnlineStatus();

  // Register/unregister abort capability for this session
  const registerAbortController = useChatStore((s) => s.registerAbortController);
  const unregisterAbortController = useChatStore((s) => s.unregisterAbortController);
  const consumeLaunchPayload = useChatStore((s) => s.consumeLaunchPayload);
  const enqueueMessage = useChatStore((s) => s.enqueueMessage);
  const peekNextMessage = useChatStore((s) => s.peekNextMessage);
  const removeQueuedMessageAction = useChatStore((s) => s.removeQueuedMessage);
  const queuedMessages = useChatStore(
    (s) => s.messageQueue[sessionId] ?? NO_QUEUED_MESSAGES,
  );
  const removeQueuedMessage = useCallback(
    (id: string) => removeQueuedMessageAction(sessionId, id),
    [removeQueuedMessageAction, sessionId],
  );
  // True while an ask_user question is unanswered — the auto-send effect below
  // must not dequeue the next message on top of a paused turn awaiting a form
  // answer (the composer itself is also disabled for typing/submitting while
  // this is true, via ChatInput's `awaitingAnswer` prop).
  const awaitingAnswer = hasPendingAskUser(chat.messages);
  // Live isolated runs (render-time mirror of livePendingRunsRef).
  const toolsBusy = parallelBrowseRuns > 0;
  const abortControllerRef = useRef<AbortController | null>(null);

  // In-flight tool calls' AbortControllers (see onToolCall), aborted on the
  // same terminal-abandonment paths as the taste checks below.
  const pendingToolCallAbortsRef = useRef<Set<AbortController>>(new Set());
  // Every Jev taste-check `AbortController` currently in flight for this
  // session (one per batch_design/edit_embed_html call awaiting a check
  // inside `onToolCall` above) — a Set, not a single controller, because
  // more than one such call can overlap. `clearStreamingToolSession` below
  // aborts every entry on every terminal-abandonment path for this session
  // (user Stop, an external abort e.g. closing this chat tab, a failed
  // request, and unmount), so a check still running when the turn is
  // stopped returns promptly (tasteCheck.ts's fail-open catch) instead of
  // running out its own ~8s timeout — `onToolCall`'s await then resolves
  // with the tool's real, already-committed result. Each entry is removed
  // (by `onToolCall`'s own `finally`) once its check settles, so this never
  // grows across a session's lifetime.
  const pendingTasteCheckAbortsRef = useRef<Set<AbortController>>(new Set());

  // Every `${toolName}:${toolCallId}` this session has ever staged a
  // streaming frame for (across every registered streaming-tool adapter,
  // src/lib/streamingTools/), and the subset that were abandoned
  // (stop/error/unmount) rather than completed. AI SDK v6 deliberately keeps
  // the partial assistant message — and its still-`input-streaming` tool
  // part — in `chat.messages` after `Chat.stop()`/an aborted request (that's
  // what `ignoreIncompleteToolCalls` in `convertToModelMessages` exists for).
  // `clearStreamingToolSession` wipes each adapter's own per-session state
  // (drafts, in-progress mutations, `finalizedKeys`, ...) on those terminal
  // paths, so without a separate, never-cleared record here, the staging
  // effect below would re-dispatch a frame for that abandoned call the
  // moment `chat.messages` next changes (e.g. sending a follow-up message).
  // A ref Set, not store state, because it must survive exactly the clears
  // that wipe each adapter's own store.
  const seenStreamingCallsRef = useRef<Map<string, { toolName: string; toolCallId: string }>>(
    new Map()
  );
  const abandonedStreamingToolKeysRef = useRef<Set<string>>(new Set());

  // Every `${toolName}:${toolCallId}` whose handler actually ran to
  // completion (the `onToolCall` branch above resolved and delivered
  // `addToolOutput`). This is deliberately NOT derived from a tool part's
  // `state` in `chat.messages` — see the "ready" sweep effect below for why
  // that would be unreliable for the one case it exists to catch (a
  // validation failure never invokes `onToolCall` at all, yet still reaches
  // `state: "output-available"`'s sibling terminal state before this hook
  // gets a chance to look). A ref, not store state: it only gates the sweep
  // effect's own read, so it never needs to trigger a re-render.
  const completedStreamingCallKeysRef = useRef<Set<string>>(new Set());

  function streamingToolKey(toolName: string, toolCallId: string): string {
    return `${toolName}:${toolCallId}`;
  }

  // Every streaming-tool adapter's per-session state (transient previews,
  // in-flight progressive mutations, ...) must never outlive this session on
  // any terminal path except an ordinary "ready" — the final tool handler
  // owns commit-before-clear on success, and a paused ask_user turn is not a
  // terminal path at all. Each adapter's `onSessionClear` only touches THIS
  // session, so concurrent sessions are unaffected.
  //
  // Every one of this function's callers (the abort-controller's `onAbort`
  // below, the user-facing `stop` callback further down, the "request
  // failed" effect, and this hook's own unmount cleanup) is exactly the set
  // of terminal paths on which any Jev taste check still in flight
  // (`pendingTasteCheckAbortsRef` above) must be cut short, so those
  // controllers are aborted here, once, rather than at each call site.
  const clearStreamingToolSession = useCallback(() => {
    turnStoppedRef.current = true;
    for (const controller of pendingTasteCheckAbortsRef.current) {
      controller.abort();
    }
    for (const controller of pendingToolCallAbortsRef.current) {
      controller.abort();
    }
    // Live isolated runs answer "aborted" at once: the step is complete and busy
    // ends now. The handler's cleanup (closeSession) goes on in the background and
    // its late result is ignored.
    for (const run of [...livePendingRunsRef.current.values()]) {
      run.controller.abort();
      run.settle(ABORTED_RUN_OUTPUT);
    }
    for (const [key, call] of seenStreamingCallsRef.current) {
      if (abandonedStreamingToolKeysRef.current.has(key)) continue;
      abandonedStreamingToolKeysRef.current.add(key);
      getStreamingToolAdapter(call.toolName)?.onAbandon({
        sessionId,
        toolCallId: call.toolCallId,
      });
      panelEndStream(call.toolCallId, "abandoned");
    }
    for (const adapter of streamingToolAdapters) {
      adapter.onSessionClear(sessionId);
    }
  }, [sessionId]);

  // Any new request (a user send, the queue drain, a network retry) re-arms
  // auto-continuation — see `turnStoppedRef`.
  useEffect(() => {
    if (chat.status === "submitted") turnStoppedRef.current = false;
  }, [chat.status]);

  useEffect(() => {
    // Create an AbortController that calls chat.stop() when aborted
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const onAbort = () => {
      clearStreamingToolSession();
      chat.stop();
    };
    controller.signal.addEventListener("abort", onAbort);

    registerAbortController(sessionId, controller);

    return () => {
      controller.signal.removeEventListener("abort", onAbort);
      unregisterAbortController(sessionId);
      // Unmount cleanup: nothing else observes this session's streaming-tool
      // state once the hook is gone, so clear it here too.
      clearStreamingToolSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, registerAbortController, unregisterAbortController]);

  // Observe partial tool input as it streams in and dispatch it to whichever
  // registered adapter (src/lib/streamingTools/) owns that tool name.
  // Complete, validated final input (delivered via the tool handler in
  // onToolCall above) remains the sole barrier for a tool's "real" effect —
  // a transient preview for `draw_vector`, or a real (but rollback-able)
  // scene mutation for the progressive-mutation adapters — this effect only
  // ever forwards partial frames.
  //
  // Two guards, for two different failure modes of re-scanning the full
  // `chat.messages` array on every update:
  // - `chat.status !== "streaming"`: staging is only ever meaningful while a
  //   turn is actively in flight, so skip entirely otherwise (cheap, and
  //   covers most idle re-renders).
  // - `abandonedStreamingToolKeysRef`: the status guard alone is NOT enough —
  //   a stale `input-streaming` part from an abandoned call survives inside
  //   `chat.messages` (see the ref's declaration above) and `chat.status` is
  //   "streaming" again the moment a follow-up message is sent, so the same
  //   stale part would otherwise pass the status guard and get re-dispatched.
  //   Once a key is recorded as abandoned it is blocked permanently.
  useEffect(() => {
    if (chat.status !== "streaming") {
      return;
    }
    for (const streamed of extractStreamingToolInputs(
      chat.messages,
      streamingToolNames
    )) {
      const key = streamingToolKey(streamed.toolName, streamed.toolCallId);
      if (abandonedStreamingToolKeysRef.current.has(key)) {
        continue;
      }
      seenStreamingCallsRef.current.set(key, {
        toolName: streamed.toolName,
        toolCallId: streamed.toolCallId,
      });
      // Agent panel: forwarded to the canvas tab instead of applied here.
      if (panelForwardFrame(sessionId, streamed.toolName, streamed.toolCallId, streamed.input)) {
        continue;
      }
      getStreamingToolAdapter(streamed.toolName)?.onFrame({
        sessionId,
        toolCallId: streamed.toolCallId,
        input: streamed.input,
      });
    }
  }, [chat.messages, chat.status, sessionId]);

  // A failed request is a terminal path for this turn — any in-flight
  // streaming-tool state belongs to a call that will never complete, so it
  // must not linger. An ask_user pause is a distinct, non-error chat.status
  // and is intentionally excluded from this effect.
  useEffect(() => {
    if (chat.status === "error") {
      clearStreamingToolSession();
      // Coarse categorization only — never chat.error.message itself, which
      // can echo back request/response content.
      const message = chat.error?.message;
      const errorKind =
        message === OFFLINE_MESSAGE
          ? "offline"
          : chat.error instanceof TypeError
            ? "network"
            : "unknown";
      track("agent_turn_failed", { error_kind: errorKind });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status, clearStreamingToolSession]);

  // A "ready" transition is the other terminal path for a streaming-tool
  // call, alongside abort/error/unmount above — and it is the ONLY signal
  // for two provider failure modes that never touch `chat.status ===
  // "error"` at all (see the HIGH finding in
  // docs/superpowers/specs/2026-09-13-streaming-tool-mutations-design.md):
  //
  // - A truncated turn: the provider stops streaming mid-call, so the tool
  //   part is stuck at `state: "input-streaming"` forever. `onToolCall` is
  //   only invoked from the SDK's "tool-input-available" branch (see
  //   node_modules/ai/dist/index.mjs, the `case "tool-input-available":`
  //   block awaiting `onToolCall`), so it never fires here either.
  //   `lastAssistantMessageIsCompleteWithToolCalls` (same file, `every` over
  //   `state === "output-available" || state === "output-error"`) treats an
  //   `input-streaming` part as incomplete, so the SDK never auto-continues
  //   — the turn just settles into "ready" for good, with the call
  //   abandoned by the model.
  // - A tool-input validation failure (e.g. the backend's zod
  //   `.transform()` rejecting the final `batch_design` args under the
  //   embed-only prototype policy): the SDK's `case "tool-input-error":`
  //   branch (same file) flips the part straight to `state: "output-error"`
  //   WITHOUT ever calling `onToolCall` — that callback lives only in the
  //   sibling "tool-input-available" case. `output-error` DOES count as
  //   "complete" for `lastAssistantMessageIsCompleteWithToolCalls`, so this
  //   path is usually transient (the SDK auto-continues with the error as
  //   the tool result) — but `chat.status` still passes through "ready" once
  //   on the way, which is all this effect needs.
  //
  // Both leave `seenStreamingCallsRef` holding a call whose handler never
  // ran — so `completedStreamingCallKeysRef` (set only from inside the
  // `onToolCall` branch above) never gained its key — while progressive
  // mutations may already be committed to the scene with no undo entry
  // (streaming never calls `saveHistory`). Sweep every such call on every
  // "ready" transition and abandon it (roll back / restore original HTML),
  // exactly like the abort/error/unmount paths.
  //
  // Parallel isolated QA runs are the one exception to "ready means no handler
  // is in flight", but they are not streaming-tool calls (no adapter owns
  // browse_agent), so nothing here sweeps them; the hook-level `status` stays
  // "streaming" for them (see the override near the return).
  //
  // This can NEVER misfire on a call that is merely between
  // "tool-input-available" and its handler resolving: the stream reader
  // above `await`s `onToolCall` synchronously, in place, before it advances
  // to any later chunk — so `chat.status` cannot reach "ready" while a
  // handler is still in flight. By the time "ready" is observed, every call
  // that ever reached "tool-input-available" has either completed (recorded
  // in `completedStreamingCallKeysRef`) or errored out (never recorded, and
  // correctly swept here).
  useEffect(() => {
    if (chat.status !== "ready") {
      return;
    }
    for (const [key, call] of seenStreamingCallsRef.current) {
      if (abandonedStreamingToolKeysRef.current.has(key)) continue;
      if (completedStreamingCallKeysRef.current.has(key)) continue;
      abandonedStreamingToolKeysRef.current.add(key);
      getStreamingToolAdapter(call.toolName)?.onAbandon({
        sessionId,
        toolCallId: call.toolCallId,
      });
      panelEndStream(call.toolCallId, "abandoned");
    }
  }, [chat.status, chat.messages, sessionId]);

  // Hands a payload to the transport. Writes no React state of its own, so
  // the queue-drain effect below can call it directly without triggering a
  // cascading render (react-hooks/set-state-in-effect). Callers are
  // responsible for the preconditions `sendPayload` checks: connectivity and
  // a chat that is actually ready to take a message.
  const deliverPayload = useCallback(
    (payload: ChatLaunchPayload): boolean => {
      const text = payload.text.trim();
      const images = payload.images;
      if (!text && (!images || images.length === 0)) {
        return false;
      }

      track("chat_message_sent", {
        has_attachment: !!images && images.length > 0,
        is_slash_command: text.startsWith("/"),
        length_bucket: bucketLength(text.length),
      });
      const { msSinceOpen, isFirst } = consumeFirstPromptTiming();
      if (isFirst) {
        track("first_prompt_sent", { ms_since_open: Math.round(msSinceOpen) });
      }

      if (images && images.length > 0) {
        const parts: Array<{ type: "text"; text: string } | { type: "file"; mediaType: string; url: string }> = [];
        for (const img of images) {
          const mediaType = img.dataUrl.match(/^data:(image\/[^;]+);/)?.[1] ?? "image/png";
          parts.push({ type: "file", mediaType, url: img.dataUrl });
        }
        if (text) {
          parts.push({ type: "text", text });
        }
        chat.sendMessage({ parts });
      } else {
        chat.sendMessage({ text });
      }
      return true;
    },
    [chat]
  );

  const sendPayload = useCallback(
    (payload: ChatLaunchPayload): boolean => {
      const text = payload.text.trim();
      const images = payload.images;
      if (!text && (!images || images.length === 0)) {
        return false;
      }
      // Fail fast and locally instead of issuing a request that will hang or
      // reject once the browser notices it has no connection.
      if (isOffline()) {
        setOfflineSendRefused(true);
        return false;
      }
      // Tool work still open (isolated QA runs, any tool part without an output)
      // means the next request would carry unresolved tool parts: queue instead,
      // even after a failed request.
      if (livePendingRunsRef.current.size > 0) {
        enqueueMessage(sessionId, payload);
        return true;
      }
      // A failed request leaves the chat in "error" status; clear it so the
      // user can retry instead of the chat being stuck.
      if (chat.status === "error") {
        chat.clearError();
      } else if (chat.status === "submitted" || chat.status === "streaming") {
        // The agent is busy — queue instead of dropping the message. The
        // caller (ChatInput) treats a `true` return as "accepted" and clears
        // the composer, even though nothing was sent to the network yet.
        enqueueMessage(sessionId, payload);
        return true;
      } else if (chat.status !== "ready") {
        return false;
      }
      return deliverPayload(payload);
    },
    [chat, deliverPayload, enqueueMessage, sessionId]
  );

  // Drains, at most once per "ready" transition, either the one-shot
  // launchQueue (a parallel-tab fan-out payload) or — with lower priority —
  // the user-facing messageQueue (messages submitted via Enter while the
  // agent was busy). Both live in the same effect, with an early `return`
  // right after the launchQueue send, so the two can never both fire a send
  // in the same tick: if a launch payload was pending, it wins and the
  // messageQueue isn't even inspected until the next "ready" transition
  // (which the send itself will eventually cause, once the follow-up
  // request settles).
  useEffect(() => {
    if (chat.status !== "ready" || !isOnline || isOffline()) {
      // Consuming while offline would delete the queued payload from the
      // store without ever sending it (sendPayload's offline guard rejects
      // it), destroying a parallel-tab launch permanently. Leave it queued;
      // the isOnline dependency reruns this effect once connectivity
      // returns, at which point it's consumed and sent normally.
      //
      // The extra live `isOffline()` check guards the narrow race where the
      // isOnline *state* is still stale-true (the browser's "offline" event
      // hasn't landed yet) but connectivity is already gone: bail here,
      // before any consume/send, so a payload is never handed to the
      // transport for a connection that is already down.
      return;
    }

    if (toolsBusy) {
      // Isolated QA runs still live: their tool parts have no output yet. Wait.
      return;
    }

    const queuedPayload = consumeLaunchPayload(sessionId);
    if (queuedPayload) {
      // `deliverPayload`, not `sendPayload`: every precondition sendPayload
      // would re-check (online, status === "ready", non-empty) is already
      // established above, and going straight to the transport keeps this
      // effect from writing React state.
      deliverPayload(cloneLaunchPayload(queuedPayload));
      return;
    }

    if (awaitingAnswer) {
      // Don't dequeue on top of a turn paused for an ask_user answer.
      return;
    }

    // Guard against a narrow race: answering an ask_user question via
    // addToolOutput synchronously flips its tool part to "output-available"
    // (so `awaitingAnswer` above already reads false), but the SDK's own
    // automatic-continuation effect only flips chat.status away from "ready"
    // in a later microtask. In that window this effect could otherwise fire
    // a queued send at the same moment the SDK auto-continues the turn,
    // producing two overlapping requests.
    // `lastAssistantMessageIsCompleteWithToolCalls` returns true exactly when
    // the SDK is about to auto-send (last assistant message's last step has
    // one or more non-provider-executed tool calls and all are resolved) —
    // that's the same predicate `sendAutomaticallyWhen` uses above. When it's
    // false — no tool calls in the last step (an ordinary finished turn) or a
    // tool call still unresolved — the SDK will not auto-continue, so it's
    // safe to drain a queued message here. Skipping this tick when it's true
    // is not a lost send: once the SDK's follow-up request settles, status
    // returns to "ready" and reruns this effect with the predicate now false.
    // Not after a Stop: `sendAutomaticallyWhen` is gated by `turnStoppedRef`, so
    // no continuation is coming and a message held for the runs must go out now.
    if (!turnStoppedRef.current && lastAssistantMessageIsCompleteWithToolCalls({ messages: chat.messages })) {
      return;
    }

    const next = peekNextMessage(sessionId);
    if (!next) {
      return;
    }

    const sent = deliverPayload(cloneLaunchPayload(next.payload));
    if (sent) {
      // Only drop it from the queue once it's actually been handed off —
      // sendPayload can return false (offline race, re-entered "busy" state,
      // etc.), and dropping the item unconditionally on a peek would lose the
      // message forever. Leaving it queued on failure keeps FIFO order intact
      // and gets it retried on the next "ready" transition.
      removeQueuedMessage(next.id);
    }
  }, [
    chat.status,
    chat.messages,
    isOnline,
    awaitingAnswer,
    toolsBusy,
    consumeLaunchPayload,
    peekNextMessage,
    removeQueuedMessage,
    deliverPayload,
    sessionId,
  ]);

  const sendMessage = useCallback((): boolean => {
    const didSend = sendPayload({ text: input.trim() });
    if (didSend) {
      setInput("");
    }
    return didSend;
  }, [input, sendPayload]);

  const submitLaunchPayload = useCallback(
    (payload: ChatLaunchPayload): boolean => {
      const didSend = sendPayload(payload);
      if (didSend && payload.text.trim() === input.trim()) {
        setInput("");
      }
      return didSend;
    },
    [input, sendPayload]
  );

  const clearError = useCallback(() => {
    setOfflineSendRefused(false);
    chat.clearError();
  }, [chat]);

  // Wraps chat.stop() so a user-initiated stop clears this session's
  // in-flight streaming-tool state first — otherwise a stale preview or
  // partially-applied mutation would keep rendering after the stream that
  // produced it was cancelled.
  const stop = useCallback(() => {
    clearStreamingToolSession();
    chat.stop();
  }, [chat, clearStreamingToolSession]);

  // Derived, not stored: the offline banner is exactly "a send was refused
  // and we are still offline". Coming back online retires it on its own, so
  // no send path — user-facing or the queue drain — has to clear it.
  const offlineError =
    offlineSendRefused && !isOnline ? OFFLINE_SEND_ERROR : undefined;

  // Invariant: while isolated QA runs are live the hook reports "streaming" even
  // though `chat.status` is "ready" (the stream ended, the runs did not). Every
  // consumer of `status`/`isLoading` therefore treats the turn as in flight.
  const status = toolsBusy && chat.status === "ready" ? "streaming" : chat.status;

  return {
    messages: chat.messages,
    input,
    setInput,
    sendMessage,
    submitLaunchPayload,
    status,
    isLoading: status === "submitted" || status === "streaming",
    stop,
    error: offlineError ?? chat.error,
    clearError,
    setMessages,
    retryState,
    addToolOutput: chat.addToolOutput,
    queuedMessages,
    removeQueuedMessage,
  };
}
