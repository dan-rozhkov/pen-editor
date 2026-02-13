import { XIcon, TrashIcon } from "@phosphor-icons/react";
import { useChatStore } from "@/store/chatStore";
import { useDesignChat } from "@/hooks/useDesignChat";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";

export function ChatPanel() {
  const isOpen = useChatStore((s) => s.isOpen);
  const close = useChatStore((s) => s.close);

  const {
    messages,
    input,
    setInput,
    sendMessage,
    isLoading,
    stop,
    error,
    clearError,
    setMessages,
  } = useDesignChat();

  if (!isOpen) {
    return null;
  }

  return (
    <div className="absolute top-0 right-0 bottom-0 z-40 pointer-events-none">
      <div className="pointer-events-auto w-[360px] h-full bg-surface-panel border-l border-border-default flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default shrink-0">
          <span className="text-sm font-medium text-text-primary flex-1">
            Design Agent
          </span>
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="p-1 rounded-lg hover:bg-surface-hover text-text-muted transition-colors"
              title="Clear messages"
            >
              <TrashIcon size={14} />
            </button>
          )}
          <button
            onClick={close}
            className="p-1 rounded-lg hover:bg-surface-hover text-text-muted transition-colors"
            title="Close"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400 flex items-center gap-2">
            <span className="flex-1 truncate">
              {error.message || "Something went wrong"}
            </span>
            <button
              onClick={clearError}
              className="shrink-0 text-red-300 hover:text-red-100 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Messages */}
        <MessageList messages={messages} isLoading={isLoading} />

        {/* Input */}
        <ChatInput
          input={input}
          setInput={setInput}
          onSubmit={sendMessage}
          isLoading={isLoading}
          stop={stop}
        />
      </div>
    </div>
  );
}
