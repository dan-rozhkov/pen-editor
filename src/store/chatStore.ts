import { create } from "zustand";
import type { ChatMessage, ToolCall, ToolCallStatus } from "@/types/chat";

interface ChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingMessageId: string | null;

  toggleOpen: () => void;
  open: () => void;
  close: () => void;
  addUserMessage: (content: string) => void;
  addAssistantMessage: (id: string, content: string) => void;
  updateAssistantMessage: (id: string, content: string) => void;
  setStreaming: (streaming: boolean, messageId?: string | null) => void;
  addToolCall: (messageId: string, toolCall: ToolCall) => void;
  updateToolCallStatus: (
    messageId: string,
    toolCallId: string,
    status: ToolCallStatus,
    result?: string,
    error?: string
  ) => void;
  clearMessages: () => void;
}

let nextId = 1;

export const useChatStore = create<ChatState>((set) => ({
  isOpen: false,
  messages: [],
  isStreaming: false,
  streamingMessageId: null,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),

  addUserMessage: (content) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: `msg-${nextId++}`,
          role: "user",
          content,
          timestamp: Date.now(),
        },
      ],
    })),

  addAssistantMessage: (id, content) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { id, role: "assistant", content, timestamp: Date.now() },
      ],
    })),

  updateAssistantMessage: (id, content) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
    })),

  setStreaming: (streaming, messageId) =>
    set({ isStreaming: streaming, streamingMessageId: messageId ?? null }),

  addToolCall: (messageId, toolCall) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, toolCalls: [...(m.toolCalls ?? []), toolCall] }
          : m
      ),
    })),

  updateToolCallStatus: (messageId, toolCallId, status, result, error) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              toolCalls: m.toolCalls?.map((tc) =>
                tc.id === toolCallId
                  ? { ...tc, status, ...(result != null && { result }), ...(error != null && { error }) }
                  : tc
              ),
            }
          : m
      ),
    })),

  clearMessages: () =>
    set({ messages: [], isStreaming: false, streamingMessageId: null }),
}));
