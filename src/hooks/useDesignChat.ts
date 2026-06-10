import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { modelSupportsVision } from "@/lib/chatModels";
import { resolveApiUrl } from "@/lib/apiBase";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useChatStore } from "@/store/chatStore";
import { toolHandlers } from "@/lib/toolRegistry";
import type { ChatLaunchPayload } from "@/types/chat";

function resolveChatApiUrl(): string {
  // VITE_AI_API_URL is the explicit full chat URL; honor it verbatim. Otherwise
  // derive /api/chat from the shared backend base resolver.
  const explicitApiUrl = import.meta.env.VITE_AI_API_URL as string | undefined;
  return explicitApiUrl ?? resolveApiUrl("/api/chat");
}

function buildCanvasContext(): object {
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

  const { model, agentMode } = useChatStore.getState();

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
    model,
    agentMode,
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
function stripImageParts(messages: UIMessage[]): UIMessage[] {
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

async function executeToolCall(
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

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: resolveChatApiUrl(),
        body: () => buildCanvasContext(),
        prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => {
          const { model } = useChatStore.getState();
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
    []
  );

  const chat = useChat({
    id: sessionId,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      const result = await executeToolCall(toolCall.toolName, toolCall.input);
      chat.addToolOutput({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output: result,
      });
    },
  });

  // Register/unregister abort capability for this session
  const registerAbortController = useChatStore((s) => s.registerAbortController);
  const unregisterAbortController = useChatStore((s) => s.unregisterAbortController);
  const consumeLaunchPayload = useChatStore((s) => s.consumeLaunchPayload);
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
      // A failed request leaves the chat in "error" status; clear it so the
      // user can retry instead of the chat being stuck.
      if (chat.status === "error") {
        chat.clearError();
      } else if (chat.status !== "ready") {
        return false;
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

  useEffect(() => {
    if (chat.status !== "ready") {
      return;
    }

    const queuedPayload = consumeLaunchPayload(sessionId);
    if (!queuedPayload) {
      return;
    }

    sendPayload(cloneLaunchPayload(queuedPayload));
  }, [chat.status, consumeLaunchPayload, sendPayload, sessionId]);

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

  return {
    messages: chat.messages,
    input,
    setInput,
    sendMessage,
    submitLaunchPayload,
    status: chat.status,
    isLoading: chat.status === "submitted" || chat.status === "streaming",
    stop: chat.stop,
    error: chat.error,
    clearError: chat.clearError,
    setMessages: chat.setMessages,
  };
}
