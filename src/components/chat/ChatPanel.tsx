import { XIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useChatStore } from "@/store/chatStore";
import type { ChatTab } from "@/store/chatStore";
import { useDesignChat } from "@/hooks/useDesignChat";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { SelectInput } from "@/components/ui/PropertyInputs";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

const MODEL_OPTIONS = [
  { value: "moonshotai/kimi-k2.5", label: "Kimi K2.5" },
  { value: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6" },
  { value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { value: "z-ai/glm-5", label: "GLM-5" },
  { value: "minimax/minimax-m2.5", label: "Minimax M2.5" },
  { value: "qwen/qwen3.5-397b-a17b", label: "Qwen 3.5 397B" },
  { value: "qwen/qwen3.5-plus-02-15", label: "Qwen 3.5 Plus" },
  { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash" },
];

const MODE_OPTIONS = [
  { value: "edits", label: "Edits" },
  { value: "fast", label: "Fast" },
];

function TabBar() {
  const tabs = useChatStore((s) => s.tabs);
  const activeTabId = useChatStore((s) => s.activeTabId);
  const setActiveTab = useChatStore((s) => s.setActiveTab);
  const closeTab = useChatStore((s) => s.closeTab);
  const createTab = useChatStore((s) => s.createTab);

  return (
    <Tabs
      value={activeTabId}
      onValueChange={(value) => setActiveTab(value as string)}
      className="shrink-0 gap-0"
    >
      <div className="px-1 pt-1 pb-1 flex items-center overflow-x-auto">
        <TabsList variant="pill" className="flex-1 w-0 [&>*]:flex-1">
          {tabs.map((tab: ChatTab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              data-testid={`chat-tab-${tab.id}`}
              className="group/tab relative w-full pr-5"
            >
              <span className="truncate max-w-[80px]">{tab.title}</span>
              <button
                data-testid={`close-tab-${tab.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-hover text-text-muted transition-opacity"
                title="Close tab"
              >
                <XIcon size={10} />
              </button>
            </TabsTrigger>
          ))}
        </TabsList>
        <Button
          data-testid="create-tab-button"
          variant="ghost"
          size="icon"
          onClick={() => createTab()}
          title="New chat"
        >
          <PlusIcon />
        </Button>
      </div>
    </Tabs>
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
  const agentMode = useChatStore((s) => s.agentMode);
  const setAgentMode = useChatStore((s) => s.setAgentMode);
  const tabs = useChatStore((s) => s.tabs);
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

        {/* Keep all sessions mounted so tab switch doesn't reset chat state */}
        {tabs.map((tab: ChatTab) => (
          <div
            key={tab.id}
            className={tab.id === activeTabId ? "flex-1 min-h-0 flex flex-col" : "hidden"}
          >
            <ChatSession sessionId={tab.id} />
          </div>
        ))}

        {/* Model selector */}
        <div className="px-3 pb-2 shrink-0 flex items-center gap-2">
          <SelectInput
            value={agentMode}
            options={MODE_OPTIONS}
            onChange={(value) => setAgentMode(value as "edits" | "fast")}
          />
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
