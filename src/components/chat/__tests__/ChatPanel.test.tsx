import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

vi.mock("@/hooks/useDesignChat", () => ({
  useDesignChat: () => ({
    messages: mockState.messages,
    setMessages,
    input: mockState.input,
    setInput,
    submitLaunchPayload,
    isLoading: mockState.isLoading,
    stop,
    error: mockState.error,
    clearError,
    queuedMessages: [],
    removeQueuedMessage,
  }),
}));

// Avoid hitting the real model list fetch surface; a static list is enough.
vi.mock("@/hooks/useModelOptions", () => ({
  useModelOptions: () => [
    { value: "google/gemini-2.5-flash", label: "Gemini", supportsVision: true },
  ],
}));

import { ChatPanelContent } from "../ChatPanel";
import { useChatStore } from "@/store/chatStore";

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  mockState = {
    messages: [],
    input: "",
    isLoading: false,
    error: undefined,
  };
  // Single deterministic tab, vision model.
  useChatStore.setState({
    isExpanded: false,
    model: "google/gemini-2.5-flash",
    tabs: [
      {
        id: "tab-1",
        title: "Chat 1",
        model: "google/gemini-2.5-flash",
        parallelCount: 1,
      },
    ],
    activeTabId: "tab-1",
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
    expect(screen.getByText("hi agent")).toBeTruthy();
    expect(screen.getByText("hi human")).toBeTruthy();
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

    // Drive the published clearChat handler directly (same one the tab bar's
    // "Clear chat" menu item calls) rather than through the dropdown-menu
    // popover, which needs real positioning/portal behavior this test isn't
    // set up to exercise.
    useChatStore.getState().sessionActions["tab-1"]?.clearChat();

    expect(setMessages).toHaveBeenCalledWith([]);
    expect(useChatStore.getState().messageQueue["tab-1"]).toBeUndefined();
  });
});
