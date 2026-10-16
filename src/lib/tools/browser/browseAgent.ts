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
  createCheckpointRecorder,
  singleUseTool,
  type BrowseAgentResult,
} from "@sideform/browser-agent/agent/session";
import { parsePageFixture, type FixtureNetworkRule } from "@sideform/browser-agent/fixture";
import { Chat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { getRequestUserId } from "@/lib/auth/authState";
import { createChatTransport, CLIENT_CAPABILITIES } from "@/lib/chatTransport";
import type { ToolHandler } from "../../toolRegistry";
import { getBrowserBridge, isDesktopBrowserAvailable, type BrowserBridge } from "./bridge";
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
/** A normal tool (callable repeatedly: two-step sign-in), allowed only when the desktop bridge has it. */
const FILL_LOGIN_TOOL = "browse_fill_login";
/**
 * The result waits at most this long for the journal to stop; the stop goes on
 * in the background (bounded by the recorder). Mirrors CHECKPOINT_STOP_WAIT_MS
 * of the package's runBrowseAgent, which the package does not export.
 */
const CHECKPOINT_STOP_WAIT_MS = 2_000;
/** The run waits at most this long for the journal to start; later it runs without a checkpoint. */
const CHECKPOINT_START_WAIT_MS = 5_000;
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
 * identity: the desktop shell has ONE browser for all chats ("desktop"); the
 * cloud has one session per chat (the chat id).
 */
const recordingKeys = new Set<string>();
const DESKTOP_RECORDING_KEY = "desktop";

export function nestedChatId(sessionId: string | undefined, toolCallId: string | undefined): string {
  const raw = `browse.${sessionId ?? "no-session"}.${toolCallId ?? Date.now()}`;
  return raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, NESTED_ID_MAX_CHARS);
}

export const browseAgent: ToolHandler = async (args, context) => {
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  if (!goal) return JSON.stringify(goalRequiredResult());
  const url = typeof args.url === "string" ? args.url.trim() : "";
  // The gate: browse_capture reaches the subagent only on the main agent's
  // explicit `capture: true` (spec 2026-10-15-browse-capture-design.md).
  const captureAllowed = args.capture === true;

  // Saved logins: desktop only, and only when the shell has `fillLogin`
  // (an older shell, or the cloud bridge, keeps today's behavior).
  const loginAllowed = typeof getBrowserBridge(context?.sessionId)?.fillLogin === "function";

  // Lazy: useDesignChat imports toolRegistry, which imports this module.
  const { executeToolCall } = await import("@/hooks/useDesignChat");
  const parentSessionId = context?.sessionId;

  const session = createBrowseAgentSession({
    signal: context?.signal,
    extraTools: {
      ...(loginAllowed ? { [FILL_LOGIN_TOOL]: {} } : {}),
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
    executeTool: (call, { signal }) =>
      executeToolCall(
        call.toolName,
        call.input,
        { sessionId: parentSessionId, toolCallId: call.toolCallId, signal },
        "browse_agent",
      ),
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
        ...(loginAllowed ? { browseLogin: true } : {}),
        userId: getRequestUserId(),
        clientCapabilities: CLIENT_CAPABILITIES,
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

  // Fresh loop-guard ring: nested calls share the parent's sessionId.
  resetLoopGuard(parentSessionId);

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
  const bridge = getBrowserBridge(parentSessionId);
  // Without a chat id checkpoints are OFF (no safe place to keep or clear them).
  const checkpointChat = parentSessionId;
  const recordingKey = isDesktopBrowserAvailable() ? DESKTOP_RECORDING_KEY : checkpointChat;

  // Checkpoint (spec 2026-10-16-checkpoint-design.md): record the run on the
  // same bridge and take the checkpoint when it ends. The fixture stays in
  // browseCheckpointStore; the model only gets id, complete, summary, gap.
  // The recorder starts only once the input is valid (beginRecording), and
  // only when no other run of this chat records.
  let recorder: ReturnType<typeof createCheckpointRecorder> | undefined;
  let startGeneration = 0;
  const signal = context?.signal;
  /** Frees the browser's recording slot once its journal calls have settled. */
  const releaseSlot = (key: string, ...pending: Promise<unknown>[]) => {
    void Promise.allSettled(pending).then(() => recordingKeys.delete(key));
  };
  const beginRecording = async (): Promise<void> => {
    if (!bridge || !checkpointChat || !recordingKey || recordingKeys.has(recordingKey)) return;
    const key = recordingKey;
    recordingKeys.add(key);
    const rec = createCheckpointRecorder(bridge as BrowserBridge, { timeoutMs: CHECKPOINT_CALL_TIMEOUT_MS });
    startGeneration = useBrowseCheckpointStore.getState().generation(checkpointChat);
    const starting = rec.start();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const outcome = await Promise.race([
      starting.then(() => "started" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), CHECKPOINT_START_WAIT_MS);
      }),
      new Promise<"abort">((resolve) => {
        if (!signal) return;
        if (signal.aborted) return resolve("abort");
        onAbort = () => resolve("abort");
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    if (outcome === "started") {
      recorder = rec;
      return;
    }
    // No checkpoint for this run: the base would miss the first actions. A late
    // start is stopped by its token (the recorder does it); the slot stays taken
    // until the start and the stop have settled.
    releaseSlot(key, starting, rec.stop());
  };
  const endRecording = async (): Promise<void> => {
    const rec = recorder;
    if (!rec || !recordingKey) return;
    const stopping = rec.stop().catch(() => undefined);
    // Slot released when the stop has really settled, not after the 2 s wait.
    releaseSlot(recordingKey, stopping);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        stopping,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, CHECKPOINT_STOP_WAIT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  let network: FixtureNetworkRule[] | undefined;
  const finish = async (result: BrowseAgentResult, extra: Record<string, unknown>): Promise<string> => {
    let checkpoint: ReturnType<typeof checkpointForModel> | undefined;
    if (recorder && checkpointChat && result.status !== "setup_failed" && result.status !== "aborted" && result.steps > 0) {
      const taken = await recorder.capture();
      // Skip when the run was aborted or the chat cleared/deleted meanwhile:
      // the fixture holds secrets and must not recreate the chat's entry.
      const stale = signal?.aborted || useBrowseCheckpointStore.getState().generation(checkpointChat) !== startGeneration;
      if (taken.ok && !stale) {
        checkpoint = checkpointForModel(
          useBrowseCheckpointStore.getState().add(checkpointChat, {
            fixture: taken.fixture,
            ...(network && network.length > 0 ? { network } : {}),
            complete: taken.complete,
            ...(taken.gap !== undefined ? { gap: taken.gap } : {}),
            summary: taken.summary,
          }),
        );
      }
    }
    return JSON.stringify({ ...result, ...extra, ...(checkpoint ? { checkpoint } : {}) });
  };

  if (!hasSetup && !hasResume) {
    try {
      await beginRecording();
      const result = await session.run(goal, driver, { url: url || undefined, toolCallId });
      return await finish(result, {});
    } finally {
      await endRecording();
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
      parsed = entry
        ? parsePageFixture({ ...entry.fixture, ...(entry.network ? { network: entry.network } : {}) })
        : {
            ok: false,
            error: `checkpoint ${resumeId} not found — checkpoints live in the editor's memory and are lost when it reloads; start again with url or setup`,
          };
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
    ? createFixtureSetup((bridge ?? {}) as BrowserBridge, parsed.value, {
        allowNetworkMocks: true,
        snapshot: () =>
          executeToolCall(
            "browse_snapshot",
            {},
            { sessionId: parentSessionId, toolCallId: `${toolCallId ?? "browse_agent"}:setup`, signal: context?.signal },
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
  try {
    if (parsed.ok) await beginRecording();
    const result = await session.run(goal, driver, {
      toolCallId,
      setup:
        fs?.setup ??
        (async () => {
          throw new SetupError("validate", parsed.ok ? "" : parsed.error);
        }),
    });
    return await finish(result, setupApplied ? { setupApplied: true } : {});
  } finally {
    // Same order as the package's runBrowseAgent: fixture first, then the journal.
    // The mocks live until the task ends, whatever the outcome.
    await fs?.release();
    await endRecording();
    if (toolCallId) useBrowseAgentPhaseStore.getState().clearPhase(toolCallId);
  }
};
