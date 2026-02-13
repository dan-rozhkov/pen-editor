import { XIcon, TrashIcon } from "@phosphor-icons/react";
import { useChatStore } from "@/store/chatStore";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";

export function ChatPanel() {
  const isOpen = useChatStore((s) => s.isOpen);
  const close = useChatStore((s) => s.close);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const messageCount = useChatStore((s) => s.messages.length);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="absolute top-0 right-0 bottom-0 z-40 pointer-events-none">
      <div className="pointer-events-auto w-[360px] h-full bg-surface-panel/95 backdrop-blur-sm border-l border-border-default flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default shrink-0">
          <span className="text-sm font-medium text-text-primary flex-1">
            Design Agent
          </span>
          {messageCount > 0 && (
            <button
              onClick={clearMessages}
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

        {/* Messages */}
        <MessageList />

        {/* Input */}
        <ChatInput />
      </div>
    </div>
  );
}
