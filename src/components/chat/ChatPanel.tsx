import { useEffect, useRef, type ReactNode } from "react";
import {
  XIcon,
  PlusIcon,
  LightningIcon,
  SphereIcon,
  ArrowUpIcon,
  StopIcon,
  CaretDownIcon,
  ImageIcon,
  ArrowLineLeftIcon,
  DotsThreeVerticalIcon,
} from "@phosphor-icons/react";
import { useChatStore } from "@/store/chatStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import type { ChatTab, ParallelCount } from "@/store/chatStore";
import { useDesignChat } from "@/hooks/useDesignChat";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InlineAlert } from "@/components/ui/inline-alert";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { ChatLaunchPayload } from "@/types/chat";
import { useModelOptions } from "@/hooks/useModelOptions";
import { chatToMarkdown, chatFilename, downloadMarkdown } from "@/lib/chatExport";
import { RETRY_DELAY_MS } from "@/lib/retryFetch";

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

interface ComposerControlsProps {
  formId: string;
  canSubmit: boolean;
  canAttach: boolean;
  attachLabel: string;
  openFilePicker: () => void;
  isLoading: boolean;
  stop: () => void;
}

type ComposerControlsRenderer = (props: ComposerControlsProps) => ReactNode;

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
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      data-testid={`close-tab-${tab.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-secondary text-text-muted transition-opacity"
                      aria-label="Close tab"
                    >
                      <XIcon size={10} />
                    </button>
                  }
                />
                <TooltipContent>Close tab</TooltipContent>
              </Tooltip>
            </TabsTrigger>
          ))}
        </TabsList>
        <IconButton
          data-testid="create-tab-button"
          variant="ghost"
          size="icon"
          onClick={() => createTab()}
          tooltip="New chat"
        >
          <PlusIcon className="size-4" weight="light" />
        </IconButton>
        {activeActions?.hasMessages && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <IconButton
                  data-testid="chat-menu-trigger"
                  variant="ghost"
                  size="icon"
                  tooltip="Chat options"
                >
                  <DotsThreeVerticalIcon size={16} weight="bold" />
                </IconButton>
              }
            />

            <DropdownMenuContent align="end" sideOffset={4} className="min-w-44">
              <DropdownMenuItem
                data-testid="chat-menu-download"
                onClick={() => activeActions?.exportChat()}
              >
                Download chat
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="chat-menu-clear"
                onClick={() => activeActions?.clearChat()}
              >
                Clear chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </Tabs>
  );
}

function ChatSession({
  sessionId,
  isActive,
  shouldFocus,
  composerControls,
}: {
  sessionId: string;
  isActive: boolean;
  shouldFocus: boolean;
  composerControls: ComposerControlsRenderer;
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
    retryState,
  } = useDesignChat({ sessionId });

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

  // Keep the chat hook mounted for background streaming, but do not update a
  // hidden message tree on every token. Markdown parsing and auto-scroll both
  // run on the main thread and become expensive when several agents stream.
  if (!isActive) {
    return null;
  }

  const handleSubmit = (payload: ChatLaunchPayload): boolean => {
    const launchPayload = cloneLaunchPayload(payload);
    const didSend = submitLaunchPayload(launchPayload);
    if (!didSend) {
      return false;
    }

    setInput("");

    for (let i = 1; i < parallelCount; i += 1) {
      const tabId = createTab();
      queueLaunchPayload(tabId, cloneLaunchPayload(launchPayload));
    }

    setParallelCount(1);
    return true;
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
        <div className="px-3 pt-2">
          <InlineAlert
            variant="error"
            onDismiss={clearError}
            dismissLabel="Dismiss error"
          >
            {error.message || "Something went wrong"}
          </InlineAlert>
        </div>
      )}

      {/* Neutral status while the transport auto-retries a network failure;
          the red error banner only appears after retries are exhausted. */}
      {retryState && !error && (
        <div className="px-3 pt-2">
          <InlineAlert role="status">
            Network error — retrying in {RETRY_DELAY_MS / 1000} s (attempt {retryState.attempt}/
            {retryState.maxAttempts})…
          </InlineAlert>
        </div>
      )}

      {/* Messages */}
      <MessageList
        messages={messages}
        isLoading={isLoading}
        onRollback={isLoading ? undefined : handleRollback}
      />

      {/* Composer */}
      <div className="m-3 mt-2 shrink-0 overflow-hidden rounded-xl border border-border-default bg-surface-panel shadow-[0_1px_3px_rgba(0,0,0,0.08)] focus-within:border-accent-light">
        <ChatInput
          sessionId={sessionId}
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          stop={stop}
          shouldFocus={shouldFocus}
          renderFooter={(footerProps) => (
            <div className="flex items-center gap-1 px-2 pb-2 pt-1.5">
              {composerControls(footerProps)}
            </div>
          )}
        />
      </div>
    </>
  );
}

export function ChatPanelContent() {
  const isExpanded = useChatStore((s) => s.isExpanded);
  const toggleExpanded = useChatStore((s) => s.toggleExpanded);
  const model = useChatStore((s) => s.model);
  const setModel = useChatStore((s) => s.setModel);
  const modelOptions = useModelOptions();
  const parallelCount = useChatStore((s) => s.parallelCount);
  const setParallelCount = useChatStore((s) => s.setParallelCount);
  const tabs = useChatStore((s) => s.tabs);
  const activeTabId = useChatStore((s) => s.activeTabId);
  const isAgentsSectionActive = useLeftSidebarStore((s) => s.activeSection === "agents");
  const activeModelLabel =
    modelOptions.find((option) => option.value === model)?.label ?? "Model";
  const composerControls: ComposerControlsRenderer = ({
    formId,
    canSubmit,
    canAttach,
    attachLabel,
    openFilePicker,
    isLoading,
    stop,
  }) => (
    <>
      <IconButton
        type="button"
        variant="ghost"
        size="icon"
        tooltip={attachLabel}
        onClick={openFilePicker}
        disabled={!canAttach}
        className="size-[30px] text-text-muted hover:bg-secondary"
      >
        <ImageIcon size={18} weight="light" />
      </IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              variant="ghost"
              size="icon"
              tooltip={`Model: ${activeModelLabel}`}
              className="ml-auto size-[30px] text-text-muted hover:bg-secondary"
            >
              <SphereIcon size={18} weight="light" />
            </IconButton>
          }
        />
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuRadioGroup value={model} onValueChange={setModel}>
            {modelOptions.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="default"
              className="-ml-1 inline-flex h-[30px] items-center gap-1 rounded-lg px-2 text-xs leading-none text-text-muted hover:bg-secondary"
              aria-label={`Parallel agents: x${parallelCount}`}
            >
              <LightningIcon className="size-4" />
              <span>x{parallelCount}</span>
              <CaretDownIcon className="size-3" />
            </Button>
          }
        />
        <DropdownMenuContent side="top" align="end" className="min-w-20">
          <DropdownMenuRadioGroup
            value={String(parallelCount)}
            onValueChange={(value) => setParallelCount(Number(value) as ParallelCount)}
          >
            {PARALLEL_COUNT_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {isLoading ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={stop}
                className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-secondary transition-colors"
                aria-label="Stop"
              >
                <StopIcon size={18} />
              </button>
            }
          />
          <TooltipContent>Stop</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="submit"
                form={formId}
                disabled={!canSubmit}
                className={
                  canSubmit
                    ? "inline-flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors"
                    : "inline-flex size-[30px] shrink-0 items-center justify-center rounded-lg border border-border-default bg-transparent text-text-muted hover:bg-transparent disabled:opacity-100"
                }
                aria-label="Send"
              >
                <ArrowUpIcon size={18} weight="regular" />
              </button>
            }
          />
          <TooltipContent>Send</TooltipContent>
        </Tooltip>
      )}
    </>
  );

  return (
    <div className="w-full h-full bg-surface-panel flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-[49px] items-center gap-2 px-4 py-3 border-b border-border-default shrink-0">
        <span className="text-sm font-medium text-text-primary flex-1">
          Design Agent
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={toggleExpanded}
                className="-my-0.5 p-1 rounded-lg hover:bg-secondary text-text-muted transition-colors"
                aria-label={isExpanded ? "Collapse panel" : "Expand panel"}
              >
                <ArrowLineLeftIcon
                  size={16}
                  className={isExpanded ? "" : "rotate-180"}
                />
              </button>
            }
          />
          <TooltipContent>
            {isExpanded ? "Collapse panel" : "Expand panel"}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Tab bar */}
      <TabBar />

      {/* Keep all sessions mounted so tab switch doesn't reset chat state */}
      {tabs.map((tab: ChatTab) => (
        <div
          key={tab.id}
          data-testid={`chat-session-${tab.id}`}
          className={
            tab.id === activeTabId ? "flex-1 min-h-0 flex flex-col" : "hidden"
          }
        >
          <ChatSession
            sessionId={tab.id}
            isActive={tab.id === activeTabId}
            shouldFocus={isAgentsSectionActive}
            composerControls={composerControls}
          />
        </div>
      ))}
    </div>
  );
}
