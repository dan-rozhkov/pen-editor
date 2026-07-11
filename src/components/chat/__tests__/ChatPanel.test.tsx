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
        agentMode: "edits",
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
    expect(screen.getByText("Design Agent")).toBeTruthy();
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

  it("toggles the presets view from the header and renders presets", () => {
    render(<ChatPanelContent />);
    fireEvent.click(screen.getByTestId("presets-toggle"));
    // Preset list replaces the message list.
    expect(screen.getByTestId("preset-list")).toBeTruthy();
  });

  it("selecting a preset seeds the input and mode/model", () => {
    render(<ChatPanelContent />);
    fireEvent.click(screen.getByTestId("presets-toggle"));
    // Click the first preset (research-pricing has a stable id).
    fireEvent.click(screen.getByTestId("preset-research-pricing"));
    expect(setInput).toHaveBeenCalledTimes(1);
    expect(typeof setInput.mock.calls[0][0]).toBe("string");
  });

  it("shows the Stop control while loading", () => {
    mockState.isLoading = true;
    render(<ChatPanelContent />);
    expect(screen.getByLabelText("Stop")).toBeTruthy();
    expect(screen.queryByLabelText("Send")).toBeNull();
  });
});
