import { useState, useEffect, useRef } from "react";
import {
  XIcon,
  PlusIcon,
  LightningIcon,
  ArrowLineLeftIcon,
  DownloadSimpleIcon,
  DotsThreeVerticalIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useChatStore } from "@/store/chatStore";
import { useFloatingPanelsStore } from "@/store/floatingPanelsStore";
import type { AgentMode, ChatTab, ParallelCount } from "@/store/chatStore";
import { useDesignChat } from "@/hooks/useDesignChat";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { SelectWithOptions } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { CHAT_PRESETS } from "./chatPresets";
import type { ChatPreset } from "./chatPresets";
import type { ChatLaunchPayload } from "@/types/chat";
import { MODEL_OPTIONS } from "@/lib/chatModels";
import { chatToMarkdown, chatFilename, downloadMarkdown } from "@/lib/chatExport";

const MODE_OPTIONS = [
  { value: "edits", label: "Edits" },
  { value: "prototype", label: "Prototype" },
  { value: "research", label: "Research" },
];

const PARALLEL_COUNT_OPTIONS = [
  { value: "1", label: "x1" },
  { value: "2", label: "x2" },
  { value: "3", label: "x3" },
];

function cloneLaunchPayload(payload: ChatLaunchPayload): ChatLaunchPayload {
  return {
    text: payload.text,
    images: payload.images?.map((image) => ({ ...image })),
  };
}

function TabBar() {
  const tabs = useChatStore((s) => s.tabs);
  const activeTabId = useChatStore((s) => s.activeTabId);
  const setActiveTab = useChatStore((s) => s.setActiveTab);
  const closeTab = useChatStore((s) => s.closeTab);
  const createTab = useChatStore((s) => s.createTab);
  const activeActions = useChatStore((s) => s.sessionActions[s.activeTabId]);

  return (
    <Tabs
      value={activeTabId}
      onValueChange={(value) => setActiveTab(value as string)}
      className="shrink-0 gap-0"
    >
      <div className="px-1 pt-1 pb-1 flex items-center overflow-x-auto layers-scrollbar">
        <TabsList variant="pill" className="shrink-0 [&>*]:min-w-[80px]">
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
        {activeActions?.hasMessages && (
          <DropdownMenu>
            <DropdownMenuTrigger
              data-testid="chat-menu-trigger"
              title="Chat options"
              render={<Button variant="ghost" size="icon" />}
            >
              <DotsThreeVerticalIcon size={16} weight="bold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4} className="min-w-44">
              <DropdownMenuItem
                data-testid="chat-menu-download"
                onClick={() => activeActions?.exportChat()}
              >
                <DownloadSimpleIcon size={14} />
                Download chat
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="chat-menu-clear"
                onClick={() => activeActions?.clearChat()}
              >
                <TrashIcon size={14} />
                Clear chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </Tabs>
  );
}

function PresetList({ onSelect }: { onSelect: (preset: ChatPreset) => void }) {
  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-2"
      data-testid="preset-list"
    >
      {CHAT_PRESETS.map((preset) => (
        <button
          key={preset.id}
          data-testid={`preset-${preset.id}`}
          onClick={() => onSelect(preset)}
          className="text-left px-3 py-2.5 rounded-md border border-border-default hover:bg-muted"
        >
          <span className="text-[13px] text-text-primary leading-snug block">
            {preset.message}
          </span>
          <span className="text-xs text-text-muted mt-1 block capitalize">
            {preset.mode} / {preset.model}
          </span>
        </button>
      ))}
    </div>
  );
}

function ChatSession({
  sessionId,
  showPresets,
  onClosePresets,
}: {
  sessionId: string;
  showPresets: boolean;
  onClosePresets: () => void;
}) {
  const {
    messages,
    setMessages,
    input,
    setInput,
    submitLaunchPayload,
    isLoading,
    stop,
    error,
    clearError,
  } = useDesignChat({ sessionId });

  const setModel = useChatStore((s) => s.setModel);
  const setAgentMode = useChatStore((s) => s.setAgentMode);
  const parallelCount = useChatStore((s) => s.parallelCount);
  const setParallelCount = useChatStore((s) => s.setParallelCount);
  const createTab = useChatStore((s) => s.createTab);
  const queueLaunchPayload = useChatStore((s) => s.queueLaunchPayload);
  const registerSessionActions = useChatStore((s) => s.registerSessionActions);
  const unregisterSessionActions = useChatStore(
    (s) => s.unregisterSessionActions,
  );
  const tabTitle = useChatStore(
    (s) => s.tabs.find((t) => t.id === sessionId)?.title,
  );

  // Publish export/clear handlers so the tab bar dropdown can drive this
  // session. A ref keeps the handlers reading the latest messages without
  // re-registering (and re-rendering the tab bar) on every streamed token.
  const sessionDataRef = useRef({ messages, tabTitle, setMessages });
  useEffect(() => {
    sessionDataRef.current = { messages, tabTitle, setMessages };
  });
  const hasMessages = messages.length > 0;

  useEffect(() => {
    registerSessionActions(sessionId, {
      hasMessages,
      exportChat: () => {
        const { messages, tabTitle } = sessionDataRef.current;
        downloadMarkdown(chatToMarkdown(messages, tabTitle), chatFilename(tabTitle));
      },
      clearChat: () => {
        sessionDataRef.current.setMessages([]);
      },
    });
    return () => unregisterSessionActions(sessionId);
  }, [sessionId, hasMessages, registerSessionActions, unregisterSessionActions]);

  const handleSelectPreset = (preset: ChatPreset) => {
    setAgentMode(preset.mode);
    setModel(preset.model);
    setInput(preset.message);
    onClosePresets();
  };

  if (showPresets) {
    return <PresetList onSelect={handleSelectPreset} />;
  }

  const handleSubmit = (payload: ChatLaunchPayload) => {
    const launchPayload = cloneLaunchPayload(payload);
    const didSend = submitLaunchPayload(launchPayload);
    if (!didSend) {
      return;
    }

    setInput("");

    for (let i = 1; i < parallelCount; i += 1) {
      const tabId = createTab();
      queueLaunchPayload(tabId, cloneLaunchPayload(launchPayload));
    }

    setParallelCount(1);
  };

  const handleRollback = (messageId: string) => {
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;

    const text = messages[index].parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");

    setMessages(messages.slice(0, index));
    setInput(text);
  };

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
      <MessageList
        messages={messages}
        isLoading={isLoading}
        onRollback={isLoading ? undefined : handleRollback}
      />

      {/* Input */}
      <ChatInput
        input={input}
        setInput={setInput}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        stop={stop}
      />
    </>
  );
}

export function ChatPanel() {
  const isOpen = useChatStore((s) => s.isOpen);
  const isExpanded = useChatStore((s) => s.isExpanded);
  const toggleExpanded = useChatStore((s) => s.toggleExpanded);
  const close = useChatStore((s) => s.close);
  const model = useChatStore((s) => s.model);
  const setModel = useChatStore((s) => s.setModel);
  const agentMode = useChatStore((s) => s.agentMode);
  const setAgentMode = useChatStore((s) => s.setAgentMode);
  const parallelCount = useChatStore((s) => s.parallelCount);
  const setParallelCount = useChatStore((s) => s.setParallelCount);
  const tabs = useChatStore((s) => s.tabs);
  const activeTabId = useChatStore((s) => s.activeTabId);
  const [showPresets, setShowPresets] = useState(false);
  const isFloating = useFloatingPanelsStore((s) => s.isFloating);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={
        isFloating
          ? `absolute top-5 right-5 bottom-5 z-50 pointer-events-none${isExpanded ? " left-5" : ""}`
          : `absolute top-0 right-0 bottom-0 z-50 pointer-events-none${isExpanded ? " left-0" : ""}`
      }
    >
      <div
        className={
          isFloating
            ? `pointer-events-auto ${isExpanded ? "w-full" : "w-[360px]"} h-full bg-surface-panel rounded-2xl shadow-[0_0px_3px_rgba(0,0,0,0.04)] border border-border-default flex flex-col overflow-hidden`
            : `pointer-events-auto ${isExpanded ? "w-full" : "w-[360px]"} h-full bg-surface-panel ${isExpanded ? "" : "border-l "}border-border-default flex flex-col`
        }
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default shrink-0">
          <button
            onClick={toggleExpanded}
            className="p-1 rounded-lg hover:bg-surface-hover text-text-muted transition-colors"
            title={isExpanded ? "Collapse panel" : "Expand panel"}
          >
            <ArrowLineLeftIcon
              size={16}
              className={isExpanded ? "rotate-180" : ""}
            />
          </button>
          <span className="text-sm font-medium text-text-primary flex-1">
            Design Agent
          </span>
          <button
            data-testid="presets-toggle"
            onClick={() => setShowPresets((v) => !v)}
            className={`p-1 rounded-lg hover:bg-muted ${showPresets ? "text-text-primary bg-muted" : "text-text-muted"}`}
            title={showPresets ? "Hide presets" : "Show presets"}
          >
            <LightningIcon size={16} />
          </button>
          <button
            onClick={close}
            className="p-1 rounded-lg hover:bg-surface-hover text-text-muted transition-colors"
            title="Close"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Tab bar */}
        {!showPresets && <TabBar />}

        {/* Keep all sessions mounted so tab switch doesn't reset chat state */}
        {tabs.map((tab: ChatTab) => (
          <div
            key={tab.id}
            className={
              tab.id === activeTabId ? "flex-1 min-h-0 flex flex-col" : "hidden"
            }
          >
            <ChatSession
              sessionId={tab.id}
              showPresets={showPresets}
              onClosePresets={() => setShowPresets(false)}
            />
          </div>
        ))}

        {/* Model selector */}
        {!showPresets && (
          <div className="px-3 pb-2 shrink-0 flex items-center gap-2">
            <SelectWithOptions
              value={agentMode}
              options={MODE_OPTIONS}
              onValueChange={(value) => setAgentMode(value as AgentMode)}
              size="sm"
              className="w-fit"
            />
            <SelectWithOptions
              value={model}
              options={MODEL_OPTIONS}
              onValueChange={(value) => {
                if (value) setModel(value);
              }}
              size="sm"
              className="w-fit"
            />
            <SelectWithOptions
              value={String(parallelCount)}
              options={PARALLEL_COUNT_OPTIONS}
              onValueChange={(value) => {
                if (!value) return;
                setParallelCount(Number(value) as ParallelCount);
              }}
              size="sm"
              className="w-fit gap-1 pl-1.5 pr-1.5"
              triggerPrefix={
                <LightningIcon className="size-3 text-text-muted" />
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
