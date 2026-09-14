import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { UIMessage } from "ai";

// --- Mock the chat hook so ChatPanel is driven by deterministic state ---
const submitLaunchPayload =
  vi.fn<(payload: { text: string }) => boolean>(() => true);
const setInput = vi.fn();
const setMessages = vi.fn();
const stop = vi.fn();
const clearError = vi.fn();
const removeQueuedMessage = vi.fn();

let mockState: {
  messages: UIMessage[];
  input: string;
  isLoading: boolean;
  error: Error | undefined;
};

// Every chat in the store mounts its own <ChatSession> (hidden or not), each
// calling useDesignChat with its own sessionId — so a test that needs two
// chats in different states (e.g. one awaiting an answer) overrides that
// chat's slice here instead of the shared `mockState`.
let perSessionOverrides: Record<string, Partial<typeof mockState>>;

vi.mock("@/hooks/useDesignChat", () => ({
  useDesignChat: ({ sessionId }: { sessionId: string }) => {
    const state = { ...mockState, ...perSessionOverrides[sessionId] };
    return {
      messages: state.messages,
      setMessages,
      input: state.input,
      setInput,
      submitLaunchPayload,
      isLoading: state.isLoading,
      stop,
      error: state.error,
      clearError,
      queuedMessages: [],
      removeQueuedMessage,
    };
  },
}));


import { ChatPanelContent } from "../ChatPanel";
import { useChatStore } from "@/store/chatStore";
import type { ChatSummary } from "@/store/chatStore";

afterEach(() => cleanup());

function makeChat(overrides: Partial<ChatSummary> & { id: string }): ChatSummary {
  return {
    title: "Chat 1",
    model: "deepseek/deepseek-v4.1-flash",
    parallelCount: 1,
    titleIsAuto: true,
    unread: false,
    needsAnswer: false,
    isBusy: false,
    updatedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState = {
    messages: [],
    input: "",
    isLoading: false,
    error: undefined,
  };
  perSessionOverrides = {};
  // Single deterministic chat, already open.
  useChatStore.setState({
    isExpanded: false,
    chats: [makeChat({ id: "tab-1" })],
    activeChatId: "tab-1",
    sessionActions: {},
  });
});

describe("<ChatPanelContent />", () => {
  it("composes the header, message list and input", () => {
    render(<ChatPanelContent />);
    expect(screen.getByText("Design Agent").parentElement?.className).toContain("h-[49px]");
    // MessageList empty state
    expect(screen.getByText("Ask the design agent anything")).toBeTruthy();
    // ChatInput textarea
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("renders messages supplied by the chat hook", () => {
    mockState.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi agent" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "hi human" }],
      },
    ];
    render(<ChatPanelContent />);
    // Scoped to the transcript — the open-chat header also renders the
    // (auto-derived) title text, which can collide with a short first message.
    const transcript = screen.getByTestId("chat-session-tab-1");
    expect(within(transcript).getByText("hi agent")).toBeTruthy();
    expect(within(transcript).getByText("hi human")).toBeTruthy();
  });

  it("wires the input submit through to submitLaunchPayload", () => {
    mockState.input = "do the thing";
    render(<ChatPanelContent />);
    fireEvent.click(screen.getByLabelText("Send"));
    expect(submitLaunchPayload).toHaveBeenCalledTimes(1);
    expect(submitLaunchPayload.mock.calls[0][0]).toMatchObject({
      text: "do the thing",
    });
  });

  it("shows an error banner and dismisses it via clearError", () => {
    mockState.error = new Error("stream blew up");
    render(<ChatPanelContent />);
    expect(screen.getByText("stream blew up")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Dismiss error"));
    expect(clearError).toHaveBeenCalledTimes(1);
  });

  it("shows the Stop control while loading", () => {
    mockState.isLoading = true;
    render(<ChatPanelContent />);
    expect(screen.getByLabelText("Stop")).toBeTruthy();
    expect(screen.queryByLabelText("Send")).toBeNull();
  });

  it("shows a queue-send control alongside Stop while loading with content in the composer", () => {
    mockState.isLoading = true;
    mockState.input = "queue me";
    render(<ChatPanelContent />);
    expect(screen.getByLabelText("Stop")).toBeTruthy();
    expect(screen.getByLabelText("Queue message")).toBeTruthy();
  });

  // FIX 2 regression: clearing the chat must also drop anything sitting in
  // the messageQueue, or the auto-drain effect sends a message into the
  // now-empty session once the in-flight turn finishes.
  it("clears the message queue when Clear chat is used", () => {
    useChatStore.getState().enqueueMessage("tab-1", { text: "queued while busy" });
    mockState.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ];
    render(<ChatPanelContent />);

    // Drive the published clearChat handler directly (same one the open-chat
    // header's "Clear chat" menu item calls) rather than through the
    // dropdown-menu popover, which needs real positioning/portal behavior
    // this test isn't set up to exercise.
    useChatStore.getState().sessionActions["tab-1"]?.clearChat();

    expect(setMessages).toHaveBeenCalledWith([]);
    expect(useChatStore.getState().messageQueue["tab-1"]).toBeUndefined();
  });

  // Regression: markChatUnread's "active chat" branch used to be dead code —
  // the effect calling it was gated on `!isActive`, so an open chat's
  // updatedAt never moved and it drifted to the bottom of the list under a
  // stale "1h ago".
  it("bumps updatedAt without setting unread when the active chat gets a new reply", () => {
    useChatStore.setState({
      chats: [makeChat({ id: "tab-1", updatedAt: 100 })],
      activeChatId: "tab-1",
    });
    const { rerender } = render(<ChatPanelContent />);

    mockState.messages = [
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "hi human" }] },
    ];
    rerender(<ChatPanelContent />);

    const chat = useChatStore.getState().chats.find((c) => c.id === "tab-1");
    expect(chat?.updatedAt).toBeGreaterThan(100);
    expect(chat?.unread).toBe(false);
  });

});

describe("<ChatPanelContent /> chat list", () => {
  it("shows the chat list when no chat is active, and opens a chat from it", () => {
    useChatStore.setState({
      chats: [makeChat({ id: "tab-1", title: "Chat 1" })],
      activeChatId: null,
    });
    render(<ChatPanelContent />);

    expect(screen.getByTestId("chat-list")).toBeTruthy();
    expect(screen.getByTestId("chat-session-tab-1").className).toContain("hidden");

    fireEvent.click(screen.getByTestId("chat-list-item-tab-1"));

    expect(useChatStore.getState().activeChatId).toBe("tab-1");
    expect(screen.queryByTestId("chat-list")).toBeNull();
    expect(screen.getByTestId("chat-session-tab-1").className).not.toContain("hidden");
  });

  it("returns to the chat list via the 'All chats' back button", () => {
    render(<ChatPanelContent />); // default beforeEach state: tab-1 active
    expect(screen.queryByTestId("chat-list")).toBeNull();

    fireEvent.click(screen.getByLabelText("All chats"));

    expect(useChatStore.getState().activeChatId).toBeNull();
    expect(screen.getByTestId("chat-list")).toBeTruthy();
  });

  it("creates and opens a new chat from 'New chat' in the list", () => {
    useChatStore.setState({
      chats: [makeChat({ id: "tab-1", title: "Chat 1" })],
      activeChatId: null,
    });
    render(<ChatPanelContent />);

    fireEvent.click(screen.getByTestId("chat-list-new"));

    const { activeChatId, chats } = useChatStore.getState();
    expect(activeChatId).not.toBeNull();
    expect(chats).toHaveLength(2);
    expect(screen.queryByTestId("chat-list")).toBeNull();
  });

  it("shows 'Needs your answer' for a chat awaiting a response and sorts it first", () => {
    useChatStore.setState({
      chats: [
        makeChat({ id: "old", title: "Old chat", updatedAt: 100 }),
        makeChat({ id: "waiting", title: "Waiting chat", updatedAt: 1 }),
      ],
      activeChatId: null,
    });
    // needsAnswer is derived by the mounted (hidden) session from its own
    // messages via hasPendingAskUser — a manually-set store flag would be
    // overwritten by that session's own sync effect on mount.
    perSessionOverrides.waiting = {
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "tool-ask_user", state: "input-available", input: {} }],
        },
      ] as unknown as UIMessage[],
    };
    render(<ChatPanelContent />);

    const items = screen.getAllByTestId(/^chat-list-item-/);
    expect(items[0].getAttribute("data-testid")).toBe("chat-list-item-waiting");
    expect(
      within(screen.getByTestId("chat-list-item-waiting")).getByText(
        "Needs your answer",
      ),
    ).toBeTruthy();
  });

  it("shows an unread marker that clears once the chat is opened", () => {
    useChatStore.setState({
      chats: [makeChat({ id: "tab-1", title: "Chat 1", unread: true })],
      activeChatId: null,
    });
    render(<ChatPanelContent />);

    expect(screen.getByTestId("chat-unread-tab-1")).toBeTruthy();

    fireEvent.click(screen.getByTestId("chat-list-item-tab-1"));

    expect(useChatStore.getState().chats.find((c) => c.id === "tab-1")?.unread).toBe(
      false,
    );
  });

  it("derives the chat title from the first user message and reflects it in the list", () => {
    mockState.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "design a login screen" }] },
    ];
    render(<ChatPanelContent />); // tab-1 active per beforeEach

    expect(useChatStore.getState().chats.find((c) => c.id === "tab-1")?.title).toBe(
      "design a login screen",
    );

    fireEvent.click(screen.getByLabelText("All chats"));
    expect(
      within(screen.getByTestId("chat-list-item-tab-1")).getByText(
        "design a login screen",
      ),
    ).toBeTruthy();
  });

  it("deletes a chat from the list", () => {
    useChatStore.setState({
      chats: [
        makeChat({ id: "tab-1", title: "Chat 1" }),
        makeChat({ id: "tab-2", title: "Chat 2" }),
      ],
      activeChatId: null,
    });
    render(<ChatPanelContent />);

    fireEvent.click(screen.getByTestId("delete-chat-tab-2"));

    expect(useChatStore.getState().chats.map((c) => c.id)).toEqual(["tab-1"]);
    expect(screen.queryByTestId("chat-list-item-tab-2")).toBeNull();
  });

  // Regression: the delete button used to be a <span role="button"> nested
  // INSIDE the row's <button> — invalid HTML, and a screen reader would read
  // the whole row (title + status + "Delete chat") as one control.
  it("keeps the delete button out of the row button's accessible name", () => {
    useChatStore.setState({
      chats: [makeChat({ id: "tab-1", title: "Chat 1" })],
      activeChatId: null,
    });
    render(<ChatPanelContent />);

    const row = screen.getByTestId("chat-list-item-tab-1");
    const deleteButton = screen.getByTestId("delete-chat-tab-1");

    expect(row.textContent).not.toContain("Delete chat");
    expect(row.contains(deleteButton)).toBe(false);
    // Both are real, independently focusable/clickable <button> elements.
    expect(row.tagName).toBe("BUTTON");
    expect(deleteButton.tagName).toBe("BUTTON");
  });

  // Regression: deleting the sole remaining chat while the list itself was
  // showing (activeChatId === null) used to unconditionally jump the user
  // into the freshly-created replacement chat, when they should stay on the
  // list.
  it("deleting the last chat from the list view leaves the list showing", () => {
    useChatStore.setState({
      chats: [makeChat({ id: "tab-only", title: "Chat 1" })],
      activeChatId: null,
    });
    render(<ChatPanelContent />);

    fireEvent.click(screen.getByTestId("delete-chat-tab-only"));

    const state = useChatStore.getState();
    expect(state.activeChatId).toBeNull();
    expect(state.chats).toHaveLength(1);
    expect(state.chats[0].id).not.toBe("tab-only");
    expect(screen.getByTestId("chat-list")).toBeTruthy();
  });

  // Regression: a parallel (xN) submit called createChat(), which always
  // activates the new chat — so after sending, the user landed in the last
  // empty fan-out twin instead of the chat they actually wrote in, and that
  // original chat then got flagged unread for its own reply.
  it("keeps the original chat active when a parallel send fans out to extra chats", () => {
    useChatStore.setState({ parallelCount: 3 });
    mockState.input = "build 3 versions";
    render(<ChatPanelContent />);

    fireEvent.click(screen.getByLabelText("Send"));

    const state = useChatStore.getState();
    expect(state.activeChatId).toBe("tab-1");
    expect(state.chats).toHaveLength(3);
    expect(state.parallelCount).toBe(1);
  });

  // Regression: fan-out twins used to inherit the localStorage parallelCount
  // (3), so opening one and sending again silently re-triggered another
  // 3-way fan-out.
  it("opening a chat created by fan-out restores parallelCount 1", () => {
    useChatStore.setState({ parallelCount: 3 });
    mockState.input = "build 3 versions";
    render(<ChatPanelContent />);
    fireEvent.click(screen.getByLabelText("Send"));

    const twin = useChatStore.getState().chats.find((c) => c.id !== "tab-1");
    expect(twin).toBeDefined();
    expect(twin?.parallelCount).toBe(1);

    useChatStore.getState().openChat(twin!.id);

    expect(useChatStore.getState().parallelCount).toBe(1);
  });
  // The composer's model picker. The trigger shows the ACTIVE chat's model,
  // so it must follow a chat switch, and choosing one must go through
  // setModel (which persists it and stamps only the active chat).
  it("shows the active chat's model and switches it from the picker", async () => {
    useChatStore.setState({
      chats: [makeChat({ id: "tab-1", model: "qwen/qwen3.8-flash" })],
      activeChatId: "tab-1",
      model: "qwen/qwen3.8-flash",
    });
    render(<ChatPanelContent />);

    const trigger = screen.getByLabelText("Model: Qwen3.8 Flash");
    fireEvent.click(trigger);

    const option = await screen.findByRole("menuitemradio", { name: "GLM 5.3 Flash" });
    fireEvent.click(option);

    expect(useChatStore.getState().model).toBe("z-ai/glm-5.3-flash");
    expect(useChatStore.getState().chats[0].model).toBe("z-ai/glm-5.3-flash");
  });

  // A selection the backend list doesn't cover (a stale saved id) must still
  // name itself — "Model" alone would hide which model is running.
  it("labels an unknown selection by its id", () => {
    useChatStore.setState({
      chats: [makeChat({ id: "tab-1", model: "gone/retired-model" })],
      activeChatId: "tab-1",
      model: "gone/retired-model",
    });
    render(<ChatPanelContent />);

    expect(screen.getByLabelText("Model: gone/retired-model")).toBeTruthy();
  });
});
