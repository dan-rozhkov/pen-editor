import { XIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useChatStore } from "@/store/chatStore";
import type { ChatTab } from "@/store/chatStore";
import { useDesignChat } from "@/hooks/useDesignChat";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { SelectInput } from "@/components/ui/PropertyInputs";

const MODEL_OPTIONS = [
  { value: "moonshotai/kimi-k2.5", label: "Kimi K2.5" },
  { value: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6" },
  { value: "z-ai/glm-5", label: "GLM-5" },
  { value: "minimax/minimax-m2.5", label: "Minimax M2.5" },
  { value: "qwen/qwen3.5-397b-a17b", label: "Qwen 3.5 397B" },
];

function TabBar() {
  const tabs = useChatStore((s) => s.tabs);
  const activeTabId = useChatStore((s) => s.activeTabId);
  const setActiveTab = useChatStore((s) => s.setActiveTab);
  const closeTab = useChatStore((s) => s.closeTab);
  const createTab = useChatStore((s) => s.createTab);

  return (
    <div className="flex items-center border-b border-border-default shrink-0 overflow-x-auto">
      {tabs.map((tab: ChatTab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            data-testid={`chat-tab-${tab.id}`}
            className={`group flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-border-default select-none shrink-0 ${
              isActive
                ? "bg-surface-panel text-text-primary border-b-2 border-b-blue-500"
                : "bg-surface-panel/50 text-text-muted hover:bg-surface-hover"
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="truncate max-w-[80px]">{tab.title}</span>
            <button
              data-testid={`close-tab-${tab.id}`}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="p-0.5 rounded hover:bg-surface-hover text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
              title="Close tab"
            >
              <XIcon size={10} />
            </button>
          </div>
        );
      })}
      <button
        data-testid="create-tab-button"
        onClick={() => createTab()}
        className="px-2 py-1.5 text-text-muted hover:bg-surface-hover transition-colors shrink-0"
        title="New chat"
      >
        <PlusIcon size={14} />
      </button>
    </div>
  );
}

function ChatSession({ sessionId }: { sessionId: string }) {
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
  } = useDesignChat({ sessionId });

  return (
    <>
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

      {/* Clear button */}
      {messages.length > 0 && (
        <div className="px-3 py-1 shrink-0 flex justify-end">
          <button
            onClick={() => setMessages([])}
            className="p-1 rounded-lg hover:bg-surface-hover text-text-muted transition-colors"
            title="Clear messages"
          >
            <TrashIcon size={14} />
          </button>
        </div>
      )}

      {/* Input */}
      <ChatInput
        input={input}
        setInput={setInput}
        onSubmit={sendMessage}
        isLoading={isLoading}
        stop={stop}
      />
    </>
  );
}

export function ChatPanel() {
  const isOpen = useChatStore((s) => s.isOpen);
  const close = useChatStore((s) => s.close);
  const model = useChatStore((s) => s.model);
  const setModel = useChatStore((s) => s.setModel);
  const activeTabId = useChatStore((s) => s.activeTabId);

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
          <button
            onClick={close}
            className="p-1 rounded-lg hover:bg-surface-hover text-text-muted transition-colors"
            title="Close"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Tab bar */}
        <TabBar />

        {/* Active session */}
        <ChatSession key={activeTabId} sessionId={activeTabId} />

        {/* Model selector */}
        <div className="px-3 pb-2 shrink-0 w-fit">
          <SelectInput
            value={model}
            options={MODEL_OPTIONS}
            onChange={setModel}
          />
        </div>
      </div>
    </div>
  );
}
