import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { modelSupportsVision, resolveModel } from "@/lib/chatModels";
import { resolveApiUrl, isOffline, OFFLINE_MESSAGE } from "@/lib/apiBase";
import { createRetryingFetch, type RetryState } from "@/lib/retryFetch";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useChatStore, NO_QUEUED_MESSAGES } from "@/store/chatStore";
import { toolHandlers } from "@/lib/toolRegistry";
import type { ChatLaunchPayload } from "@/types/chat";
import { hasPendingAskUser } from "@/components/chat/pendingAskUser";

const STREAM_RENDER_THROTTLE_MS = 50;

// Exported for tests.
export function resolveChatApiUrl(): string {
  // VITE_AI_API_URL is the explicit full chat URL; honor it verbatim. Otherwise
  // derive /api/chat from the shared backend base resolver.
  const explicitApiUrl = import.meta.env.VITE_AI_API_URL as string | undefined;
  return explicitApiUrl ?? resolveApiUrl("/api/chat");
}

// A session must use ITS OWN tab's model rather than the global active-tab
// value, which setActiveTab overwrites on every tab switch. Without this,
// switching tabs while a background session streams hijacks that session's
// auto-continuation request with the foreground tab's model.
// Exported for tests.
export function resolveSessionConfig(sessionId?: string): {
  model: string;
} {
  const { model, tabs } = useChatStore.getState();
  const tab = sessionId ? tabs.find((t) => t.id === sessionId) : undefined;
  return {
    model: tab?.model ?? model,
  };
}

// Exported for tests.
export function buildCanvasContext(sessionId?: string): object {
  const { selectedIds } = useSelectionStore.getState();
  const { rootIds, nodesById } = useSceneStore.getState();
  const { activeTheme } = useThemeStore.getState();
  const { variables } = useVariableStore.getState();

  const roots = rootIds.map((id) => {
    const n = nodesById[id];
    return n ? { id: n.id, type: n.type, name: n.name } : { id };
  });

  const selectedNodes = selectedIds.map((id) => {
    const n = nodesById[id];
    if (!n) return { id };
    const rec = n as unknown as Record<string, unknown>;
    return {
      id: n.id,
      type: n.type,
      name: n.name,
      x: rec.x,
      y: rec.y,
      width: rec.width,
      height: rec.height,
    };
  });

  const { model } = resolveSessionConfig(sessionId);

  return {
    canvasContext: JSON.stringify({
      roots,
      selectedIds,
      selectedNodes,
      activeTheme,
      variables: variables.map((v) => ({
        name: v.name,
        type: v.type,
        value: v.value,
        themeValues: v.themeValues,
      })),
    }),
    model: resolveModel(model),
  };
}

function isImagePart(part: UIMessage["parts"][number]): boolean {
  return (
    part.type === "file" &&
    typeof part.mediaType === "string" &&
    part.mediaType.startsWith("image/")
  );
}

// Non-vision models reject requests whose history contains image parts, which
// would otherwise make a chat permanently broken after attaching an image.
// Replace images with a text placeholder so the model still sees that an
// attachment existed.
// Exported for tests.
export function stripImageParts(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (!message.parts.some(isImagePart)) {
      return message;
    }
    const parts = message.parts.filter((part) => !isImagePart(part));
    parts.push({
      type: "text",
      text: "[Attached image omitted: the selected model cannot read images]",
    });
    return { ...message, parts };
  });
}

// Exported for tests.
export async function executeToolCall(
  toolName: string,
  input: unknown
): Promise<string> {
  const handler = toolHandlers[toolName];
  if (!handler) {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
  const args =
    input != null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  try {
    return await Promise.race([
      handler(args),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Tool call timed out")), 30_000)
      ),
    ]);
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : "Tool call failed",
    });
  }
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

export function useDesignChat({ sessionId }: UseDesignChatOptions) {
  const [input, setInput] = useState("");
  // Set when a send is attempted while offline. Surfaced the same way as
  // `chat.error` (network/provider errors) so the chat UI doesn't need a
  // second error path, but it never touches the network — the request is
  // never issued, so there is nothing to hang.
  const [offlineError, setOfflineError] = useState<Error | undefined>();

  // Non-null while the transport is auto-retrying a network failure; drives
  // the neutral "retrying…" status line instead of the red error banner.
  const [retryState, setRetryState] = useState<RetryState | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: resolveChatApiUrl(),
        fetch: createRetryingFetch({ onRetryStateChange: setRetryState }),
        body: () => buildCanvasContext(sessionId),
        prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => {
          const { model } = resolveSessionConfig(sessionId);
          return {
            body: {
              ...body,
              id,
              messages: modelSupportsVision(model)
                ? messages
                : stripImageParts(messages),
              trigger,
              messageId,
            },
          };
        },
      }),
    [sessionId]
  );

  const chat = useChat({
    id: sessionId,
    transport,
    // AI SDK otherwise publishes a React update for every stream chunk. A
    // short throttle keeps active Markdown rendering responsive while still
    // feeling continuous, especially when multiple sessions run in parallel.
    experimental_throttle: STREAM_RENDER_THROTTLE_MS,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      // ask_user is answered by the in-chat form (AskUserForm), which calls
      // addToolOutput on submit. Leaving the part unresolved keeps the turn
      // paused (sendAutomaticallyWhen only fires once every tool call has an
      // output), which is exactly the desired human-in-the-loop behavior.
      if (toolCall.toolName === "ask_user") {
        return;
      }
      const result = await executeToolCall(toolCall.toolName, toolCall.input);
      chat.addToolOutput({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output: result,
      });
    },
  });

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
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Create an AbortController that calls chat.stop() when aborted
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const onAbort = () => {
      chat.stop();
    };
    controller.signal.addEventListener("abort", onAbort);

    registerAbortController(sessionId, controller);

    return () => {
      controller.signal.removeEventListener("abort", onAbort);
      unregisterAbortController(sessionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, registerAbortController, unregisterAbortController]);

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
        setOfflineError(new Error(OFFLINE_MESSAGE));
        return false;
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
      setOfflineError(undefined);

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
    [chat, enqueueMessage, sessionId]
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
      // before any consume/send, so we never reach sendPayload's
      // setOfflineError side-effect from inside this effect. Doing so would
      // schedule a re-render that reruns this effect and — with the queue
      // still non-empty — spin until the "offline" event finally arrives.
      return;
    }

    const queuedPayload = consumeLaunchPayload(sessionId);
    if (queuedPayload) {
      sendPayload(cloneLaunchPayload(queuedPayload));
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
    if (lastAssistantMessageIsCompleteWithToolCalls({ messages: chat.messages })) {
      return;
    }

    const next = peekNextMessage(sessionId);
    if (!next) {
      return;
    }

    const sent = sendPayload(cloneLaunchPayload(next.payload));
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
    consumeLaunchPayload,
    peekNextMessage,
    removeQueuedMessage,
    sendPayload,
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
    setOfflineError(undefined);
    chat.clearError();
  }, [chat]);

  return {
    messages: chat.messages,
    input,
    setInput,
    sendMessage,
    submitLaunchPayload,
    status: chat.status,
    isLoading: chat.status === "submitted" || chat.status === "streaming",
    stop: chat.stop,
    error: offlineError ?? chat.error,
    clearError,
    setMessages: chat.setMessages,
    retryState,
    addToolOutput: chat.addToolOutput,
    queuedMessages,
    removeQueuedMessage,
  };
}
