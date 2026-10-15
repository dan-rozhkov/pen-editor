import { resetLoopGuard } from "@sideform/browser-agent/loop";
import { Chat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { getRequestUserId } from "@/lib/auth/authState";
import { createChatTransport, CLIENT_CAPABILITIES } from "@/lib/chatTransport";
import { getOpenCodeKey } from "@/lib/opencodeKey";
import type { ToolHandler } from "../../toolRegistry";

/**
 * browse_agent — runs a browse-only sub-agent as a nested, headless chat
 * session against the same /api/chat (`agentMode: "browse"`), pinned by the
 * backend to a non-reasoning deepseek model whatever the user's main model
 * is (pen-editor-backend docs/specs/2026-10-14-browse-subagent-design.md).
 *
 * Execution stays on the client: the nested session's tool calls go through
 * the normal `executeToolCall` with the PARENT chat's sessionId, so the same
 * browser (desktop IPC / cloud Steel keyed by chat id) and the same loop
 * guard serve both. The browse_* tools are unserialized in the tool queue and
 * so is browse_agent itself (toolCallQueue.ts) — otherwise the nested calls
 * would deadlock behind their own parent.
 */

/** Model for the sub-agent, sent ONLY when the parent chat's model is an
 * `opencode-go/` model and an OpenCode key is stored. Otherwise no model is
 * sent and the backend pins its own. */
export const BROWSE_AGENT_OPENCODE_MODEL = "opencode-go/deepseek-v4.1-flash";
/** Chat-side (useDesignChat) timeout for a browse_agent call. */
export const BROWSE_AGENT_OUTER_TIMEOUT_MS = 15 * 60_000;
/** How far below the outer timeout the handler's own deadline sits, so the
 * handler returns a partial result before the chat discards everything. */
export const BROWSE_AGENT_DEADLINE_MARGIN_MS = 60_000;
/** The handler's own deadline (derived, so the two cannot drift). */
export const BROWSE_AGENT_DEADLINE_MS =
  BROWSE_AGENT_OUTER_TIMEOUT_MS - BROWSE_AGENT_DEADLINE_MARGIN_MS;
/** Max model requests (first send + automatic continuations) per run. */
export const BROWSE_AGENT_MAX_REQUESTS = 60;
const ANSWER_MAX_CHARS = 8000;
const ERROR_MAX_CHARS = 300;
const NESTED_ID_MAX_CHARS = 200;

const BROWSE_AGENT_TOOLS: ReadonlySet<string> = new Set([
  "browse_open",
  "browse_snapshot",
  "browse_screenshot",
  "browse_act",
  "browse_tabs",
  "browse_find_images",
  "browse_read",
]);

export type BrowseAgentStatus = "done" | "error" | "aborted" | "step_limit" | "timeout";

export function nestedChatId(sessionId: string | undefined, toolCallId: string | undefined): string {
  const raw = `browse.${sessionId ?? "no-session"}.${toolCallId ?? Date.now()}`;
  return raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, NESTED_ID_MAX_CHARS);
}

function textOf(parts: UIMessage["parts"]): string {
  return parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/**
 * The report. For a finished run: the last assistant message's text after its
 * last tool part. For any other status the run was cut short, so the report
 * may not exist yet: return all assistant text of the session, in order,
 * keeping the END when over the cap.
 */
function finalAnswer(messages: UIMessage[], status: BrowseAgentStatus): string {
  if (status !== "done") {
    const all = messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.parts.map((p) => (p.type === "text" ? p.text.trim() : "")))
      .filter(Boolean)
      .join("\n\n");
    return all.length > ANSWER_MAX_CHARS ? all.slice(-ANSWER_MAX_CHARS) : all;
  }
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  if (!last) return "";
  let lastToolIdx = -1;
  last.parts.forEach((p, i) => {
    if (p.type.startsWith("tool-") || p.type === "dynamic-tool") lastToolIdx = i;
  });
  return textOf(last.parts.slice(lastToolIdx + 1)).trim().slice(0, ANSWER_MAX_CHARS);
}

function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.slice(0, ERROR_MAX_CHARS);
}

export const browseAgent: ToolHandler = async (args, context) => {
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  if (!goal) {
    return JSON.stringify({ status: "error", answer: "", steps: 0, error: "goal is required" });
  }
  const url = typeof args.url === "string" ? args.url.trim() : "";

  // Lazy: useDesignChat imports toolRegistry, which imports this module.
  const { executeToolCall, resolveSessionModel } = await import("@/hooks/useDesignChat");

  const parentSessionId = context?.sessionId;
  const parentSignal = context?.signal;
  // Pin the OpenCode Go model only when the user chose an opencode-go chat
  // model AND has a key; anything else (OpenRouter chat, Zen-only or lapsed
  // key) lets the backend pin its own, so no plan is billed unasked.
  const useOpenCodeModel =
    resolveSessionModel(parentSessionId).startsWith("opencode-go/") && !!getOpenCodeKey();

  // Fresh loop-guard ring: nested calls share the parent's sessionId.
  resetLoopGuard(parentSessionId);

  const deadline = new AbortController();
  const toolSignal = parentSignal ? AbortSignal.any([parentSignal, deadline.signal]) : deadline.signal;
  let timedOut = false;

  let requests = 1;
  let steps = 0;
  let stopped = false;
  let stepLimit = false;
  let streamError: unknown;
  const pending = new Set<Promise<void>>();

  const chat: Chat<UIMessage> = new Chat<UIMessage>({
    id: nestedChatId(parentSessionId, context?.toolCallId),
    transport: createChatTransport({
      // No canvasContext: the sub-agent never sees the scene. The model is
      // only sent for an opencode-go chat model with a key; otherwise the
      // backend pins its own.
      body: () => ({
        agentMode: "browse",
        userId: getRequestUserId(),
        clientCapabilities: CLIENT_CAPABILITIES,
        ...(useOpenCodeModel ? { model: BROWSE_AGENT_OPENCODE_MODEL } : {}),
      }),
    }),
    sendAutomaticallyWhen: (options) => {
      if (stopped || !lastAssistantMessageIsCompleteWithToolCalls(options)) return false;
      if (requests >= BROWSE_AGENT_MAX_REQUESTS) {
        stepLimit = true;
        return false;
      }
      requests += 1;
      return true;
    },
    onError: (err) => {
      streamError = err;
    },
    onToolCall: ({ toolCall }) => {
      const run = (async () => {
        let output: string;
        if (!BROWSE_AGENT_TOOLS.has(toolCall.toolName)) {
          output = JSON.stringify({
            error: `Tool ${toolCall.toolName} is not available to the browse agent. Use only: ${[...BROWSE_AGENT_TOOLS].join(", ")}.`,
          });
        } else {
          steps += 1;
          try {
            output = await executeToolCall(
              toolCall.toolName,
              toolCall.input,
              { sessionId: parentSessionId, toolCallId: toolCall.toolCallId, signal: toolSignal },
              "browse_agent",
            );
          } catch (err) {
            output = JSON.stringify({ error: errorMessage(err) });
          }
        }
        // Always written, even after a stop: an input-available part with no
        // output would poison later requests (same rule as useDesignChat).
        chat.addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output });
      })();
      pending.add(run);
      void run.finally(() => pending.delete(run));
      // Awaited like the main chat's onToolCall so the stream stays open
      // until the result is in.
      return run;
    },
  });

  const stop = () => {
    stopped = true;
    void chat.stop();
  };
  if (parentSignal?.aborted) stopped = true;
  else parentSignal?.addEventListener("abort", stop, { once: true });

  let onDeadline!: () => void;
  const deadlineHit = new Promise<void>((resolve) => {
    onDeadline = resolve;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.abort();
    stop();
    onDeadline();
  }, BROWSE_AGENT_DEADLINE_MS);

  const result = (status: BrowseAgentStatus, extra?: { error?: string }) =>
    JSON.stringify({ status, answer: finalAnswer(chat.messages, status), steps, ...extra });

  try {
    if (stopped) return result("aborted");
    // Open the start page before the first model request: the subagent starts
    // on its snapshot instead of spending a whole request on browse_open.
    let text = goal;
    if (url) {
      steps += 1;
      const opened = await executeToolCall(
        "browse_open",
        { url },
        { sessionId: parentSessionId, toolCallId: `${context?.toolCallId ?? "browse_agent"}:open`, signal: toolSignal },
        "browse_agent",
      );
      if (stopped || timedOut) return result(timedOut ? "timeout" : "aborted");
      text = `${goal}\n\nThe browser already opened ${url} for you (browse_open). Its result, with a snapshot of the page:\n${opened}`;
    }
    // sendMessage resolves after the whole auto-continuation chain; the
    // deadline race is the backstop for a hung stream.
    await Promise.race([
      chat.sendMessage({ text }).catch((err) => {
        streamError ??= err;
      }),
      deadlineHit,
    ]);
    if (timedOut) return result("timeout");
    await Promise.allSettled([...pending]);
    if (timedOut) return result("timeout");
    if (stopped || parentSignal?.aborted) return result("aborted");
    if (streamError ?? chat.error) {
      return result("error", { error: errorMessage(streamError ?? chat.error) });
    }
    if (stepLimit) return result("step_limit");
    return result("done");
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", stop);
  }
};
