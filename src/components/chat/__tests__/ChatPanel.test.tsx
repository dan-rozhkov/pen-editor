import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import type { UIMessage } from "ai";

// --- Mock the chat hook so ChatPanel is driven by deterministic state ---
const submitLaunchPayload =
  vi.fn<(payload: { text: string }) => boolean>(() => true);
const setInput = vi.fn();
const setMessages = vi.fn();
const stop = vi.fn();
const clearError = vi.fn();

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

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

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
    };
  },
}));


import { ChatPanelContent } from "../ChatPanel";
import { useChatStore } from "@/store/chatStore";
import { useOpenCodeKeyDialogStore } from "@/store/openCodeKeyDialogStore";
import type { ChatSummary } from "@/store/chatStore";
import { clearOpenCodeKey, setOpenCodeKey } from "@/lib/opencodeKey";
import { createWorkflow, deleteWorkflow, stepsFromTexts } from "@/lib/workflows/workflowStore";
import { workflowToPrompt } from "@/lib/workflows/workflowMarkdown";
import { resetBrowseCheckpoints, useBrowseCheckpointStore } from "@/store/browseCheckpointStore";

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
    expect(screen.getByText("Sideform Agent").parentElement?.className).toContain("h-[49px]");
    // MessageList empty state
    expect(screen.getByText("Ask Sideform Agent anything")).toBeTruthy();
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

  it("shows a send-now control alongside Stop while loading with content in the composer", () => {
    mockState.isLoading = true;
    mockState.input = "send me now";
    render(<ChatPanelContent />);
    expect(screen.getByLabelText("Stop")).toBeTruthy();
    expect(screen.getByLabelText("Send now")).toBeTruthy();
  });

  it("empties the transcript when Clear chat is used", () => {
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
  });

  it("drops the chat's browser checkpoints when Clear chat is used", () => {
    useBrowseCheckpointStore.getState().add("tab-1", { fixture: { version: 1, url: "https://a.test" } as never, complete: true, summary: "s" });
    render(<ChatPanelContent />);
    useChatStore.getState().sessionActions["tab-1"]?.clearChat();
    expect(useBrowseCheckpointStore.getState().byChat["tab-1"]).toBeUndefined();
    resetBrowseCheckpoints();
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

describe("<ChatPanelContent /> OpenCode BYOK picker", () => {
  afterEach(() => {
    clearOpenCodeKey();
  });

  // Locked entries must render disabled and not be selectable — the whole
  // point of gating them on a stored key (see chatModels.ts's
  // requiresUserKey / opencodeKey.ts).
  it("renders a requiresUserKey entry as locked and unselectable when no key is stored", async () => {
    clearOpenCodeKey();
    useChatStore.setState({
      chats: [makeChat({ id: "tab-1", model: "deepseek/deepseek-v4.1-flash" })],
      activeChatId: "tab-1",
      model: "deepseek/deepseek-v4.1-flash",
    });
    render(<ChatPanelContent />);

    fireEvent.click(screen.getByLabelText("Model: DeepSeek V4.1 Flash"));

    const locked = await screen.findByRole("menuitemradio", {
      name: /GLM 5\.3 Flash · Go/,
    });
    expect(locked.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(locked);
    // A disabled radio item must not flip the active selection.
    expect(useChatStore.getState().model).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("makes a requiresUserKey entry selectable once a key is saved", async () => {
    setOpenCodeKey("sk-test-panel");
    useChatStore.setState({
      chats: [makeChat({ id: "tab-1", model: "deepseek/deepseek-v4.1-flash" })],
      activeChatId: "tab-1",
      model: "deepseek/deepseek-v4.1-flash",
    });
    render(<ChatPanelContent />);

    fireEvent.click(screen.getByLabelText("Model: DeepSeek V4.1 Flash"));

    const unlocked = await screen.findByRole("menuitemradio", {
      name: /GLM 5\.3 Flash · Go/,
    });
    expect(unlocked.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(unlocked);
    expect(useChatStore.getState().model).toBe("opencode-go/glm-5.3-flash");
  });

  it("opens the OpenCode key dialog from the picker", async () => {
    clearOpenCodeKey();
    useChatStore.setState({
      chats: [makeChat({ id: "tab-1", model: "deepseek/deepseek-v4.1-flash" })],
      activeChatId: "tab-1",
      model: "deepseek/deepseek-v4.1-flash",
    });
    render(<ChatPanelContent />);

    fireEvent.click(screen.getByLabelText("Model: DeepSeek V4.1 Flash"));
    const connectItem = await screen.findByText("Connect OpenCode…");
    fireEvent.click(connectItem);

    expect(await screen.findByText("OpenCode key")).toBeTruthy();
  });

  // Defect 1 (code review): `composerControls` used to have
  // `<OpenCodeKeyDialog>` embedded in its OWN returned JSX, which is invoked
  // from inside `ChatSession` (`ChatPanel.tsx`'s "Keep all sessions mounted"
  // block maps every open chat to a `<ChatSession>`). In this codebase,
  // `ChatSession` already early-returns `null` for a session that isn't
  // `isActive` (a pre-existing perf guard, unrelated to this feature — see
  // the "do not update a hidden message tree" comment), so composerControls
  // in practice never renders for more than one tab AT ONCE: the literal
  // "several simultaneously-live dialogs from N open tabs" symptom the
  // review flagged does not reproduce through `chats.map` as it stands.
  //
  // What DOES reproduce, and is what this test pins: since the dialog's
  // React component instance lived inside the ACTIVE tab's subtree, opening
  // it and then switching the active tab unmounted `ChatSession` for the
  // old tab (destroying the dialog instance, mid-interaction) and mounted a
  // BRAND NEW one for the newly-active tab — silently discarding whatever
  // the user had typed, and, had a check been in flight, orphaning that
  // fetch's `setState` calls against an unmounted component. Hoisting the
  // dialog to the `ChatPanelContent` root (this file, next to `SkillsPage`,
  // which already used this exact pattern) makes it a single component
  // instance for the panel's whole lifetime, independent of which tab is
  // active — so it now survives a tab switch intact, which is what this
  // test asserts. The duplicate-node checks the review specifically asked
  // for (single input, single `#opencode-key-dialog-description`) are kept
  // too, as a standing invariant, even though they do not by themselves
  // discriminate the fixed code from the buggy one in this codebase.
  it("keeps the OpenCode key dialog's in-progress state across a chat-tab switch, as a single instance", async () => {
    clearOpenCodeKey();
    useChatStore.setState({
      chats: [
        makeChat({ id: "tab-1", model: "deepseek/deepseek-v4.1-flash" }),
        makeChat({ id: "tab-2", model: "deepseek/deepseek-v4.1-flash" }),
      ],
      activeChatId: "tab-1",
      model: "deepseek/deepseek-v4.1-flash",
    });
    render(<ChatPanelContent />);

    fireEvent.click(screen.getByLabelText("Model: DeepSeek V4.1 Flash"));
    const connectItem = await screen.findByText("Connect OpenCode…");
    fireEvent.click(connectItem);
    await screen.findByText("OpenCode key");
    // `getByLabelText` also matches the dialog's own `role="dialog"`
    // container (labelled via `aria-labelledby` -> the title), so query the
    // actual <input> directly rather than via the looser accessible-name
    // match.
    const getInput = () =>
      document.querySelector<HTMLInputElement>(
        'input[aria-label="OpenCode key"]',
      );

    const input = getInput();
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: "sk-in-progress" } });
    expect(getInput()!.value).toBe("sk-in-progress");

    // Switch the active tab WHILE the dialog is open and mid-edit — this is
    // exactly the interaction the old placement lost.
    act(() => {
      useChatStore.getState().openChat("tab-2");
    });

    const inputAfterSwitch = getInput();
    expect(inputAfterSwitch).toBeTruthy();
    expect(inputAfterSwitch!.value).toBe("sk-in-progress");

    // Still exactly one live dialog/input/description node, not one
    // destroyed-and-recreated pair or (were the old per-session placement
    // ever reintroduced without the isActive guard) several.
    expect(
      document.querySelectorAll('input[aria-label="OpenCode key"]'),
    ).toHaveLength(1);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(
      document.querySelectorAll("#opencode-key-dialog-description"),
    ).toHaveLength(1);
  });
});

describe("ChatPanelContent variants", () => {
  beforeEach(() => {
    // an earlier test may leave the modal OpenCode dialog open (hides the rest)
    useOpenCodeKeyDialogStore.setState({ open: false });
  });

  it("sidebar variant (default) keeps the title row, skills button and expand toggle", () => {
    render(<ChatPanelContent />);
    expect(screen.getByText("Sideform Agent")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Manage skills" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /(Expand|Collapse) panel/ })).toBeTruthy();
  });

  it("standalone variant has no title row and no expand toggle", () => {
    render(<ChatPanelContent variant="standalone" isVisible />);
    expect(screen.queryByText("Sideform Agent")).toBeNull();
    expect(screen.queryByRole("button", { name: /(Expand|Collapse) panel/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Manage skills" })).toHaveLength(1);
  });
});

describe("ChatPanelContent skills page", () => {
  beforeEach(() => {
    useOpenCodeKeyDialogStore.setState({ open: false });
    useChatStore.setState({ activeChatId: null });
  });

  it("opens in place of the chat list, and Back returns to it", () => {
    render(<ChatPanelContent />);
    expect(screen.getByTestId("chat-list")).toBeTruthy();

    fireEvent.click(screen.getByTestId("manage-skills-button"));
    expect(screen.getByTestId("skills-page")).toBeTruthy();
    expect(screen.queryByTestId("chat-list")).toBeNull();
    expect(screen.getByTestId("manage-skills-button").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByTestId("skills-page-back"));
    expect(screen.queryByTestId("skills-page")).toBeNull();
    expect(screen.getByTestId("chat-list")).toBeTruthy();
  });

  it("hides the open chat while shown, keeps it mounted, and the skills button toggles the page off", () => {
    useChatStore.setState({ activeChatId: "tab-1" });
    render(<ChatPanelContent />);
    expect(screen.getByTestId("chat-session-tab-1").className).not.toContain("hidden");

    fireEvent.click(screen.getByTestId("manage-skills-button"));
    expect(screen.getByTestId("skills-page")).toBeTruthy();
    expect(screen.getByTestId("chat-session-tab-1").className).toContain("hidden");

    fireEvent.click(screen.getByTestId("manage-skills-button"));
    expect(screen.queryByTestId("skills-page")).toBeNull();
    expect(screen.getByTestId("chat-session-tab-1").className).not.toContain("hidden");
  });

  it("treats the open chat session as inactive while shown (renders nothing, restores on return)", () => {
    useChatStore.setState({ activeChatId: "tab-1" });
    render(<ChatPanelContent />);
    const session = screen.getByTestId("chat-session-tab-1");
    expect(session.childElementCount).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("manage-skills-button"));
    expect(session.childElementCount).toBe(0);

    fireEvent.click(screen.getByTestId("manage-skills-button"));
    expect(session.childElementCount).toBeGreaterThan(0);
  });

  it("closes when the active chat changes underneath it", () => {
    render(<ChatPanelContent />);
    fireEvent.click(screen.getByTestId("manage-skills-button"));
    expect(screen.getByTestId("skills-page")).toBeTruthy();

    act(() => useChatStore.setState({ activeChatId: "tab-1" }));
    expect(screen.queryByTestId("skills-page")).toBeNull();
  });
});

describe("<ChatPanelContent /> rollback with an attached workflow", () => {
  const rollbackTo = (text: string) => {
    mockState.messages = [{ id: "u1", role: "user", parts: [{ type: "text", text }] }];
    render(<ChatPanelContent />);
    fireEvent.click(screen.getByLabelText("Roll back to this message"));
  };

  beforeEach(() => {
    localStorage.clear();
    toastMock.mockClear();
    useChatStore.setState({ attachedWorkflowIds: {} });
  });

  it("restores only the user's text and re-attaches a stored workflow", () => {
    const wf = createWorkflow({ title: "Launch", steps: stepsFromTexts(["Open"]) }, "editor");
    rollbackTo(`do it\n\n${workflowToPrompt(wf)}`);
    expect(setInput).toHaveBeenCalledWith("do it");
    expect(useChatStore.getState().attachedWorkflowIds["tab-1"]).toBe(wf.id);
  });

  it("re-attaches by id even when another workflow shares the title", () => {
    createWorkflow({ title: "Launch", steps: stepsFromTexts(["Other"]) }, "editor");
    const wf = createWorkflow({ title: "Launch", steps: stepsFromTexts(["Open"]) }, "editor");
    createWorkflow({ title: "Launch", steps: stepsFromTexts(["Newest"]) }, "editor");
    rollbackTo(`do it\n\n${workflowToPrompt(wf)}`);
    expect(useChatStore.getState().attachedWorkflowIds["tab-1"]).toBe(wf.id);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("restores the text and toasts when the workflow was deleted", () => {
    const wf = createWorkflow({ title: "Gone", steps: stepsFromTexts(["x"]) }, "editor");
    const block = workflowToPrompt(wf);
    deleteWorkflow(wf.id, "editor");
    rollbackTo(`do it\n\n${block}`);
    expect(setInput).toHaveBeenCalledWith("do it");
    expect(useChatStore.getState().attachedWorkflowIds["tab-1"]).toBeUndefined();
    expect(toastMock).toHaveBeenCalledWith("The workflow \u201cGone\u201d no longer exists. It was not re-attached.");
  });

  it("restores the text and toasts for an old block without an id", () => {
    createWorkflow({ title: "Old", steps: stepsFromTexts(["x"]) }, "editor");
    rollbackTo('do it\n\n<workflow title="Old">\nInstruction\n\n1. x\n</workflow>');
    expect(setInput).toHaveBeenCalledWith("do it");
    expect(useChatStore.getState().attachedWorkflowIds["tab-1"]).toBeUndefined();
    expect(toastMock).toHaveBeenCalledTimes(1);
  });
});
