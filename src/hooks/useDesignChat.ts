import { useState, useCallback, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { useChatStore } from "@/store/chatStore";
import { toolHandlers } from "@/lib/toolRegistry";

function resolveChatApiUrl(): string {
  const explicitApiUrl = import.meta.env.VITE_AI_API_URL as string | undefined;
  if (explicitApiUrl) {
    return explicitApiUrl;
  }

  const backendUrl = import.meta.env.VITE_DESIGN_AGENT_BACKEND_URL as string | undefined;
  if (backendUrl) {
    return `${backendUrl.replace(/\/$/, "")}/api/chat`;
  }

  return "/api/chat";
}

function buildCanvasContext(): object {
  const { selectedIds } = useSelectionStore.getState();
  const { rootIds, nodesById } = useSceneStore.getState();
  const { activeTheme } = useThemeStore.getState();

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

  const { model } = useChatStore.getState();

  return { canvasContext: JSON.stringify({ roots, selectedIds, selectedNodes, activeTheme }), model };
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

export function useDesignChat() {
  const [input, setInput] = useState("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: resolveChatApiUrl(),
        body: () => buildCanvasContext(),
      }),
    []
  );

  const chat = useChat({
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

  const sendMessage = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text || chat.status !== "ready") return;
      chat.sendMessage({ text });
      setInput("");
    },
    [input, chat]
  );

  return {
    messages: chat.messages,
    input,
    setInput,
    sendMessage,
    status: chat.status,
    isLoading: chat.status === "submitted" || chat.status === "streaming",
    stop: chat.stop,
    error: chat.error,
    clearError: chat.clearError,
    setMessages: chat.setMessages,
  };
}
