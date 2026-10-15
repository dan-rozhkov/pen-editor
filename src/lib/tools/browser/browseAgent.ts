import { resetLoopGuard } from "@sideform/browser-agent/loop";
import {
  BROWSE_AGENT_DEADLINE_MARGIN_MS,
  BROWSE_AGENT_DEADLINE_MS,
  BROWSE_AGENT_MAX_REQUESTS,
  BROWSE_AGENT_OUTER_TIMEOUT_MS,
  createBrowseAgentSession,
  goalRequiredResult,
  singleUseTool,
} from "@sideform/browser-agent/agent/session";
import { Chat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { getRequestUserId } from "@/lib/auth/authState";
import { createChatTransport, CLIENT_CAPABILITIES } from "@/lib/chatTransport";
import type { ToolHandler } from "../../toolRegistry";

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

  // Lazy: useDesignChat imports toolRegistry, which imports this module.
  const { executeToolCall } = await import("@/hooks/useDesignChat");
  const parentSessionId = context?.sessionId;

  const session = createBrowseAgentSession({
    signal: context?.signal,
    extraTools: captureAllowed
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
      : {},
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

  const result = await session.run(
    goal,
    {
      send: (text) => chat.sendMessage({ text }),
      stop: () => void chat.stop(),
      messages: () => chat.messages,
      error: () => chat.error,
    },
    { url: url || undefined, toolCallId: context?.toolCallId },
  );
  return JSON.stringify(result);
};
