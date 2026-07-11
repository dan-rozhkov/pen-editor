import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";

// Static model list so ChatPanel doesn't try to fetch /api/models.
vi.mock("@/hooks/useModelOptions", () => ({
  useModelOptions: () => [
    { value: "google/gemini-2.5-flash", label: "Gemini", supportsVision: true },
  ],
}));

import { ChatPanelContent } from "../ChatPanel";
import { useChatStore } from "@/store/chatStore";

// A held-open SSE stream we can push deltas into on demand, so we can interleave
// streaming across two sessions exactly the way the user does by hand.
function makeStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const send = (chunk: Record<string, unknown>) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  const done = () => {
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
  };
  const response = new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
  return { response, send, done };
}

afterEach(() => cleanup());

describe("ChatPanel streaming across two sessions", () => {
  let streams: ReturnType<typeof makeStream>[];

  beforeEach(() => {
    streams = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/chat")) {
        const s = makeStream();
        streams.push(s);
        return s.response;
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    useChatStore.setState({
      isExpanded: false,
      model: "google/gemini-2.5-flash",
      agentMode: "edits",
      parallelCount: 1,
      tabs: [
        { id: "tab-1", title: "Chat 1", model: "google/gemini-2.5-flash", agentMode: "edits", parallelCount: 1 },
        { id: "tab-2", title: "Chat 2", model: "google/gemini-2.5-flash", agentMode: "edits", parallelCount: 1 },
      ],
      activeTabId: "tab-1",
      abortControllers: {},
      launchQueue: {},
      sessionActions: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function streamText(s: ReturnType<typeof makeStream>, id: string, text: string) {
    s.send({ type: "start" });
    s.send({ type: "start-step" });
    s.send({ type: "text-start", id });
    s.send({ type: "text-delta", id, delta: text });
  }

  async function submitIn(testId: string, text: string) {
    const container = screen.getByTestId(testId);
    const textarea = within(container).getByPlaceholderText(
      "Ask the design agent...",
    ) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: text } });
    });
    await act(async () => {
      fireEvent.click(within(container).getByLabelText("Send"));
    });
  }

  it("keeps each session's stream in its own tab when switching mid-stream", async () => {
    render(<ChatPanelContent />);

    // Tab 1: send and begin streaming "AAA" (left open).
    await submitIn("chat-session-tab-1", "first message");
    await waitFor(() => expect(streams.length).toBe(1));
    await act(async () => {
      streamText(streams[0], "t1", "AAA-from-chat-1");
    });
    await waitFor(() =>
      expect(
        within(screen.getByTestId("chat-session-tab-1")).queryByText(
          /AAA-from-chat-1/,
        ),
      ).toBeTruthy(),
    );

    // Switch to tab 2, send and stream "BBB".
    act(() => {
      useChatStore.getState().setActiveTab("tab-2");
    });
    await submitIn("chat-session-tab-2", "second message");
    await waitFor(() => expect(streams.length).toBe(2));
    await act(async () => {
      streamText(streams[1], "t2", "BBB-from-chat-2");
    });
    await waitFor(() =>
      expect(
        within(screen.getByTestId("chat-session-tab-2")).queryByText(
          /BBB-from-chat-2/,
        ),
      ).toBeTruthy(),
    );

    const tab1 = screen.getByTestId("chat-session-tab-1");
    const tab2 = screen.getByTestId("chat-session-tab-2");

    // Each session must show ONLY its own stream.
    expect(within(tab1).queryByText(/AAA-from-chat-1/)).toBeTruthy();
    expect(within(tab1).queryByText(/BBB-from-chat-2/)).toBeNull();
    expect(within(tab2).queryByText(/BBB-from-chat-2/)).toBeTruthy();
    expect(within(tab2).queryByText(/AAA-from-chat-1/)).toBeNull();
  });

  it("keeps tab-1's stream when a NEW tab is created mid-stream", async () => {
    // Start with a single tab — the new tab is created while tab-1 streams.
    useChatStore.setState({
      tabs: [
        { id: "tab-1", title: "Chat 1", model: "google/gemini-2.5-flash", agentMode: "edits", parallelCount: 1 },
      ],
      activeTabId: "tab-1",
    });

    render(<ChatPanelContent />);

    // Tab 1: send and stream "AAA" (left open — still streaming).
    await submitIn("chat-session-tab-1", "first message");
    await waitFor(() => expect(streams.length).toBe(1));
    await act(async () => {
      streamText(streams[0], "t1", "AAA-from-chat-1");
    });
    await waitFor(() =>
      expect(
        within(screen.getByTestId("chat-session-tab-1")).queryByText(/AAA-from-chat-1/),
      ).toBeTruthy(),
    );

    // Create a new tab WHILE tab-1 is mid-stream (the "+" button / parallel).
    let newTabId = "";
    act(() => {
      newTabId = useChatStore.getState().createTab();
    });

    await submitIn(`chat-session-${newTabId}`, "second message");
    await waitFor(() => expect(streams.length).toBe(2));
    await act(async () => {
      streamText(streams[1], "t2", "BBB-from-chat-2");
    });

    // Finish tab-1's stream after the new tab streamed.
    await act(async () => {
      streams[0].send({ type: "text-end", id: "t1" });
      streams[0].send({ type: "finish-step" });
      streams[0].send({ type: "finish" });
      streams[0].done();
    });

    // Switch back to tab-1: it must still show its OWN content, not chat-2's.
    act(() => {
      useChatStore.getState().setActiveTab("tab-1");
    });

    const tab1 = screen.getByTestId("chat-session-tab-1");
    const tab2 = screen.getByTestId(`chat-session-${newTabId}`);

    expect(within(tab1).queryByText(/AAA-from-chat-1/)).toBeTruthy();
    expect(within(tab1).queryByText(/BBB-from-chat-2/)).toBeNull();
    expect(within(tab2).queryByText(/BBB-from-chat-2/)).toBeTruthy();
    expect(within(tab2).queryByText(/AAA-from-chat-1/)).toBeNull();
  });
});
