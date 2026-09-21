import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  PlusIcon,
  LightningIcon,
  ArrowUpIcon,
  ArrowLeftIcon,
  StopIcon,
  CaretDownIcon,
  ImageIcon,
  ArrowLineLeftIcon,
  DotsThreeVerticalIcon,
  BookOpenIcon,
  SphereIcon,
  LockIcon,
} from "@phosphor-icons/react";
import { useChatStore } from "@/store/chatStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useUserSkillStore } from "@/store/userSkillStore";
import type { ChatSummary, ParallelCount } from "@/store/chatStore";
import { useDesignChat } from "@/hooks/useDesignChat";
import { useModelOptions } from "@/hooks/useModelOptions";
import { useAgentActivityToast } from "@/hooks/useAgentActivityToast";
import { getUserId } from "@/lib/userId";
import { hasOpenCodeKey, subscribeOpenCodeKey } from "@/lib/opencodeKey";
import { useOpenCodeKeyDialogStore } from "@/store/openCodeKeyDialogStore";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { ChatList } from "./ChatList";
import { QueuedMessagePanel } from "./QueuedMessagePanel";
import { SkillsPanel } from "./SkillsPanel";
import { ContextMeter } from "./ContextMeter";
import { OpenCodeKeyDialog } from "./OpenCodeKeyDialog";
import { hasPendingAskUser } from "./pendingAskUser";
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
import { chatToMarkdown, chatFilename, downloadMarkdown } from "@/lib/chatExport";

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

/** Compact header shown above the transcript once a chat is open — replaces
 * the old tab bar now that a chat is opened from (and returned to) the list. */
function OpenChatHeader({ chatId }: { chatId: string }) {
  const chatTitle = useChatStore(
    (s) => s.chats.find((c) => c.id === chatId)?.title ?? "",
  );
  const showChatList = useChatStore((s) => s.showChatList);
  const createChat = useChatStore((s) => s.createChat);
  const activeActions = useChatStore((s) => s.sessionActions[chatId]);

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border-default px-2 py-1.5">
      <IconButton
        data-testid="back-to-chat-list"
        variant="ghost"
        size="icon"
        onClick={() => showChatList()}
        tooltip="All chats"
      >
        <ArrowLeftIcon className="size-4" weight="light" />
      </IconButton>
      <span
        data-testid="chat-header-title"
        className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-text-primary"
      >
        {chatTitle}
      </span>
      <IconButton
        data-testid="create-chat-button"
        variant="ghost"
        size="icon"
        onClick={() => createChat()}
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
  );
}

function ChatSession({
  sessionId,
  isActive,
  isVisible,
  composerControls,
  onManageSkills,
}: {
  sessionId: string;
  isActive: boolean;
  /** True while this session's chat is actually on screen — agents section
   * active AND, on mobile, the left panel open. Drives MessageList's
   * re-pin-to-bottom and ChatInput's autofocus/resize on becoming visible
   * again (the mobile panel now stays mounted `display: none` rather than
   * unmounting when closed). */
  isVisible: boolean;
  composerControls: ComposerControlsRenderer;
  onManageSkills: () => void;
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
    addToolOutput,
    queuedMessages,
    removeQueuedMessage,
    status,
  } = useDesignChat({ sessionId });

  // Surfaces server-side memory/skill writes that happen after this turn's
  // stream already closed (background review) — the model has no chance to
  // mention these itself. See useAgentActivityToast for the delayed-check
  // design.
  useAgentActivityToast({ userId: getUserId(), status });

  const awaitingAnswer = hasPendingAskUser(messages);

  const parallelCount = useChatStore((s) => s.parallelCount);
  const setParallelCount = useChatStore((s) => s.setParallelCount);
  const createChat = useChatStore((s) => s.createChat);
  const queueLaunchPayload = useChatStore((s) => s.queueLaunchPayload);
  const registerSessionActions = useChatStore((s) => s.registerSessionActions);
  const unregisterSessionActions = useChatStore(
    (s) => s.unregisterSessionActions,
  );
  const applyAutoTitle = useChatStore((s) => s.applyAutoTitle);
  const markChatUnread = useChatStore((s) => s.markChatUnread);
  const markChatRead = useChatStore((s) => s.markChatRead);
  const setChatActivity = useChatStore((s) => s.setChatActivity);
  const chatTitle = useChatStore(
    (s) => s.chats.find((c) => c.id === sessionId)?.title,
  );
  const hasQueuedMessages = queuedMessages.length > 0;

  // Derives the chat's title from its first user message, once. `applyAutoTitle`
  // itself is a no-op once the chat's `titleIsAuto` flag is cleared, but the ref
  // still saves a redundant store dispatch on every one of the many re-renders
  // a streaming turn causes after that first message lands.
  const autoTitleAppliedRef = useRef(false);
  useEffect(() => {
    if (autoTitleAppliedRef.current) return;
    const firstUserMessage = messages.find((m) => m.role === "user");
    if (!firstUserMessage) return;
    const text = firstUserMessage.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    if (!text) return;
    autoTitleAppliedRef.current = true;
    applyAutoTitle(sessionId, text);
  }, [messages, sessionId, applyAutoTitle]);

  // Keeps the chat-list status ("Working…" / "Needs your answer") in sync.
  // `setChatActivity` no-ops when neither flag actually changed, so this is
  // safe to run on every render without flooding the store with updates.
  useEffect(() => {
    setChatActivity(sessionId, { needsAnswer: awaitingAnswer, isBusy: isLoading });
  }, [sessionId, awaitingAnswer, isLoading, setChatActivity]);

  // Reports new activity — a new assistant reply, or the agent starting to
  // wait on the user — to the store on every such event, active chat or not.
  // `markChatUnread` itself decides what that means: the active chat only
  // gets its `updatedAt` bumped (so recency ordering reflects the activity
  // without an unread badge on a chat the user is looking at), a background
  // chat gets both. Refs track the previous values so this fires once per
  // event rather than on every streamed token (assistant message count grows
  // once per reply, not once per delta — deltas mutate an existing message
  // rather than adding one).
  const prevAssistantCountRef = useRef(0);
  const prevAwaitingAnswerRef = useRef(false);
  useEffect(() => {
    const assistantCount = messages.filter((m) => m.role === "assistant").length;
    const assistantGrew = assistantCount > prevAssistantCountRef.current;
    prevAssistantCountRef.current = assistantCount;
    const awaitingAnswerStarted = awaitingAnswer && !prevAwaitingAnswerRef.current;
    prevAwaitingAnswerRef.current = awaitingAnswer;
    if (assistantGrew || awaitingAnswerStarted) {
      markChatUnread(sessionId);
    }
  }, [messages, awaitingAnswer, sessionId, markChatUnread]);

  // openChat() already clears unread when the user picks a chat from the
  // list, but a chat can also become active another way (e.g. createChat()
  // opens its new chat directly) — cover that path here too.
  useEffect(() => {
    if (isActive) {
      markChatRead(sessionId);
    }
  }, [isActive, sessionId, markChatRead]);

  // Publish export/clear handlers so the chat header's menu can drive this
  // session. A ref keeps the handlers reading the latest messages without
  // re-registering (and re-rendering the chat header) on every streamed token.
  const sessionDataRef = useRef({ messages, chatTitle, setMessages });
  useEffect(() => {
    sessionDataRef.current = { messages, chatTitle, setMessages };
  });
  const hasMessages = messages.length > 0;

  useEffect(() => {
    registerSessionActions(sessionId, {
      hasMessages,
      exportChat: () => {
        const { messages, chatTitle } = sessionDataRef.current;
        downloadMarkdown(chatToMarkdown(messages, chatTitle), chatFilename(chatTitle));
      },
      clearChat: () => {
        sessionDataRef.current.setMessages([]);
        // Also drop any messages queued while the agent was busy — otherwise
        // the auto-drain effect in useDesignChat sends a "cleared" message
        // into the now-empty session once the in-flight turn finishes.
        useChatStore.getState().clearMessageQueue(sessionId);
        // An empty transcript has no context usage yet — leaving the old
        // reading would show a stale meter over nothing.
        useChatStore.getState().clearContextTokens(sessionId);
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

    // Fan-out chats are created inactive with parallelCount pinned to 1 —
    // createChat()'s default (activate: true) would otherwise leave the user
    // in the last empty fan-out chat instead of the one they just wrote in,
    // and restoring a stale x3 from this chat would re-trigger the fan-out
    // the next time the user sends a message in one of the twins.
    for (let i = 1; i < parallelCount; i += 1) {
      const chatId = createChat({ activate: false, parallelCount: 1 });
      queueLaunchPayload(chatId, cloneLaunchPayload(launchPayload));
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
    // The transcript just shrank, so the last measured context size (taken
    // before the rollback) no longer describes this chat — leaving it would
    // show a near-full, red meter over a three-message session until the
    // next turn finishes. Same reasoning as clearChat above.
    useChatStore.getState().clearContextTokens(sessionId);
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
            Connection problem — retrying
            {retryState.delayMs !== undefined
              ? ` in ${Math.max(1, Math.round(retryState.delayMs / 1000))} s`
              : ""}{" "}
            (attempt {retryState.attempt}/{retryState.maxAttempts})…
          </InlineAlert>
        </div>
      )}

      {/* Messages */}
      <MessageList
        messages={messages}
        isLoading={isLoading}
        onRollback={isLoading ? undefined : handleRollback}
        addToolOutput={addToolOutput}
        isVisible={isVisible}
      />

      {/* Queued-message panel — sits between the transcript and
          the composer, its bottom 12px hidden under the composer card. When
          it renders (own `mt-2` matches the composer's usual top margin
          below), the composer's top margin is dropped so the panel's `-mb-3`
          overlap isn't undone by a competing positive margin. */}
      <QueuedMessagePanel
        queuedMessages={queuedMessages}
        onRemoveQueued={removeQueuedMessage}
      />

      {/* Composer */}
      <div
        className={`relative z-10 m-3 shrink-0 overflow-hidden rounded-xl border border-border-default bg-surface-panel shadow-[0_1px_3px_rgba(0,0,0,0.08)] focus-within:border-accent-light ${
          hasQueuedMessages ? "mt-0" : "mt-2"
        }`}
      >
        <ChatInput
          sessionId={sessionId}
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          stop={stop}
          shouldFocus={isVisible}
          awaitingAnswer={awaitingAnswer}
          onManageSkills={onManageSkills}
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
  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const isAgentsSectionActive = useLeftSidebarStore((s) => s.activeSection === "agents");
  const isMobile = useIsMobile();
  const isPanelOpen = useLeftSidebarStore((s) => s.isPanelOpen);
  // Whether the Agents chat is actually on screen, not just the active
  // section: on mobile the left panel can be closed while Agents stays the
  // active section — and now that LeftSidebar keeps the chat subtree mounted
  // (`display: none`) instead of unmounting it, MessageList's scroll
  // position and ChatInput's focus/resize effects need this real visibility
  // signal instead of a boolean that never changes across close/reopen.
  const isChatVisible = isAgentsSectionActive && (!isMobile || isPanelOpen);
  const [isSkillsPanelOpen, setSkillsPanelOpen] = useState(false);
  const isOpenCodeDialogOpen = useOpenCodeKeyDialogStore((s) => s.open);
  const setOpenCodeDialogOpen = useOpenCodeKeyDialogStore((s) => s.setOpen);
  const ensureSkillsHydrated = useUserSkillStore((s) => s.ensureHydrated);
  // Re-renders the picker the moment a key is saved/removed in the dialog,
  // so a just-unlocked model becomes selectable without a reload.
  const hasKey = useSyncExternalStore(
    subscribeOpenCodeKey,
    hasOpenCodeKey,
    hasOpenCodeKey,
  );

  // Hydrate the user's custom skills once the chat panel mounts (not on every
  // slash-menu keystroke) so the slash menu can list them alongside the
  // built-ins without each open needing a fresh fetch.
  useEffect(() => {
    void ensureSkillsHydrated();
  }, [ensureSkillsHydrated]);
  // Falls back to the id itself, never a generic "Model": a selection the
  // backend list doesn't cover is exactly when the user needs to see WHICH
  // model they're on. reconcileModels() resets such a selection once
  // GET /api/models answers.
  const activeModelLabel =
    modelOptions.find((option) => option.value === model)?.label ?? model;
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
      <div className="ml-auto flex items-center gap-1">
        <ContextMeter />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton
                type="button"
                variant="ghost"
                size="icon"
                tooltip={`Model: ${activeModelLabel}`}
                className="size-[30px] text-text-muted hover:bg-secondary"
              >
                <SphereIcon size={18} weight="light" />
              </IconButton>
            }
          />
          <DropdownMenuContent side="top" align="end" className="w-56">
            <DropdownMenuRadioGroup value={model} onValueChange={setModel}>
              {modelOptions.map((option) => {
                const locked = Boolean(option.requiresUserKey) && !hasKey;
                return (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    disabled={locked}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate">{option.label}</span>
                      {locked && (
                        <LockIcon
                          size={12}
                          weight="light"
                          className="shrink-0 text-text-muted"
                        />
                      )}
                    </span>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setOpenCodeDialogOpen(true)}>
              {hasKey ? "OpenCode key" : "Connect OpenCode…"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="default"
              className="inline-flex h-[30px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs leading-none text-text-muted hover:bg-secondary"
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
      {isLoading && (
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
      )}
      {/* Stop above always stays available while loading; this button is the
          mouse/touch affordance for queuing a message on top of a busy agent
          (Enter already does this) — shown whenever there's content to send,
          loading or not. */}
      {(!isLoading || canSubmit) && (
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
                aria-label={isLoading ? "Queue message" : "Send"}
              >
                <ArrowUpIcon size={18} weight="regular" />
              </button>
            }
          />
          <TooltipContent>{isLoading ? "Queue message" : "Send"}</TooltipContent>
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
                onClick={() => setSkillsPanelOpen(true)}
                className="-my-0.5 p-1 rounded-lg hover:bg-secondary text-text-muted transition-colors"
                aria-label="Manage skills"
              >
                <BookOpenIcon size={16} />
              </button>
            }
          />
          <TooltipContent>Manage skills</TooltipContent>
        </Tooltip>
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

      {activeChatId === null ? (
        <ChatList />
      ) : (
        <OpenChatHeader chatId={activeChatId} />
      )}

      {/* Keep all sessions mounted so switching chats doesn't reset chat state.
          While the chat list is shown (activeChatId === null) every session is
          hidden — there is no active one. */}
      {chats.map((chat: ChatSummary) => (
        <div
          key={chat.id}
          data-testid={`chat-session-${chat.id}`}
          className={
            chat.id === activeChatId ? "flex-1 min-h-0 flex flex-col" : "hidden"
          }
        >
          <ChatSession
            sessionId={chat.id}
            isActive={chat.id === activeChatId}
            isVisible={isChatVisible}
            composerControls={composerControls}
            onManageSkills={() => setSkillsPanelOpen(true)}
          />
        </div>
      ))}

      <SkillsPanel open={isSkillsPanelOpen} onOpenChange={setSkillsPanelOpen} />
      {/* Mounted once here, not inside `composerControls` — that renderer runs
          once per mounted ChatSession (every open chat tab, not just the
          active one, so switching tabs doesn't reset session state), so a
          dialog embedded in its returned JSX would mount once per tab.
          With N open chats that's N stacked backdrops, N focus traps, and N
          copies of `id="opencode-key-dialog-description"` (invalid DOM, and
          aria-describedby only ever resolves to the first). The open/close
          state already lived at this level for the same reason SkillsPanel's
          does. */}
      <OpenCodeKeyDialog
        open={isOpenCodeDialogOpen}
        onOpenChange={setOpenCodeDialogOpen}
      />
    </div>
  );
}
