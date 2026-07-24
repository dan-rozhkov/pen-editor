import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { UIMessage } from "ai";
import {
  stripImageParts,
  executeToolCall,
  buildCanvasContext,
  resolveChatApiUrl,
  useDesignChat,
} from "@/hooks/useDesignChat";
import { toolHandlers } from "@/lib/toolRegistry";
import { useSelectionStore } from "@/store/selectionStore";
import { useChatStore } from "@/store/chatStore";
import { resetStores, seedScene, seedVariables } from "@/test/fixtures";

const TEST_TOOL = "__test_tool__";

function clearChatApiEnv() {
  vi.stubEnv("VITE_AI_API_URL", undefined);
  vi.stubEnv("VITE_DESIGN_AGENT_BACKEND_URL", undefined);
}

afterEach(() => {
  delete toolHandlers[TEST_TOOL];
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function textMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

describe("stripImageParts", () => {
  it("returns messages without image parts by reference (no copy)", () => {
    const messages = [
      textMessage("m1", "hello"),
      {
        id: "m2",
        role: "user",
        parts: [
          { type: "file", mediaType: "application/pdf", url: "data:application/pdf;base64,AA" },
          { type: "text", text: "see attachment" },
        ],
      } as UIMessage,
    ];

    const result = stripImageParts(messages);
    expect(result[0]).toBe(messages[0]);
    // non-image file parts are not images — message untouched
    expect(result[1]).toBe(messages[1]);
    expect(result[1].parts).toHaveLength(2);
  });

  it("replaces image file parts with a text placeholder", () => {
    const withImage: UIMessage = {
      id: "m1",
      role: "user",
      parts: [
        { type: "file", mediaType: "image/png", url: "data:image/png;base64,AA" },
        { type: "text", text: "look at this" },
      ],
    };

    const [result] = stripImageParts([withImage]);
    expect(result).not.toBe(withImage);
    expect(result.parts.some((p) => p.type === "file")).toBe(false);
    expect(result.parts).toEqual([
      { type: "text", text: "look at this" },
      {
        type: "text",
        text: "[Attached image omitted: the selected model cannot read images]",
      },
    ]);
    // original message is not mutated
    expect(withImage.parts).toHaveLength(2);
    expect(withImage.parts[0].type).toBe("file");
  });

  it("strips multiple image parts from one message", () => {
    const msg: UIMessage = {
      id: "m1",
      role: "user",
      parts: [
        { type: "file", mediaType: "image/png", url: "u1" },
        { type: "file", mediaType: "image/jpeg", url: "u2" },
      ],
    };
    const [result] = stripImageParts([msg]);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].type).toBe("text");
  });
});

describe("executeToolCall", () => {
  it("returns a JSON error for an unknown tool", async () => {
    const result = await executeToolCall("definitely_not_a_tool", {});
    expect(JSON.parse(result)).toEqual({
      error: "Unknown tool: definitely_not_a_tool",
    });
  });

  it("returns a JSON error when the handler throws", async () => {
    toolHandlers[TEST_TOOL] = async () => {
      throw new Error("boom");
    };
    const result = await executeToolCall(TEST_TOOL, {});
    expect(JSON.parse(result)).toEqual({ error: "boom" });
  });

  it("passes {} to the handler for null or non-object input", async () => {
    const seen: unknown[] = [];
    toolHandlers[TEST_TOOL] = async (args) => {
      seen.push(args);
      return "ok";
    };

    await executeToolCall(TEST_TOOL, null);
    await executeToolCall(TEST_TOOL, "a string");
    await executeToolCall(TEST_TOOL, 42);
    expect(seen).toEqual([{}, {}, {}]);
  });

  it("passes object input through to the handler and returns its result", async () => {
    toolHandlers[TEST_TOOL] = async (args) => JSON.stringify(args);
    const result = await executeToolCall(TEST_TOOL, { a: 1 });
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it("times out after 30 seconds", async () => {
    vi.useFakeTimers();
    toolHandlers[TEST_TOOL] = () => new Promise<string>(() => {});

    const pending = executeToolCall(TEST_TOOL, {});
    await vi.advanceTimersByTimeAsync(30_001);
    const result = await pending;
    expect(JSON.parse(result)).toEqual({ error: "Tool call timed out" });
  });
});

describe("buildCanvasContext", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    seedVariables();
  });

  it("serializes scene roots, selection, variables and model, with no agentMode", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] });
    useChatStore.setState({ model: "test/model-x" });

    const context = buildCanvasContext() as Record<string, unknown>;

    expect(context.model).toBe("test/model-x");
    expect(context).not.toHaveProperty("agentMode");

    const canvas = JSON.parse(context.canvasContext as string);
    expect(canvas.roots).toEqual([
      { id: "frame1", type: "frame", name: "Screen" },
      { id: "rect2", type: "rect", name: "Floating" },
    ]);
    expect(canvas.selectedIds).toEqual(["rect1"]);
    expect(canvas.selectedNodes).toEqual([
      { id: "rect1", type: "rect", name: "Box", x: 10, y: 20, width: 100, height: 50 },
    ]);
    expect(canvas.activeTheme).toBe("light");
    expect(canvas.variables).toEqual([
      {
        name: "--primary",
        type: "color",
        value: "#3366ff",
        themeValues: { light: "#3366ff", dark: "#99bbff" },
      },
      { name: "--radius-m", type: "number", value: "8" },
    ]);
  });

  it("falls back to bare ids for unknown selected nodes", () => {
    useSelectionStore.setState({ selectedIds: ["ghost"] });
    const context = buildCanvasContext() as { canvasContext: string };
    const canvas = JSON.parse(context.canvasContext);
    expect(canvas.selectedNodes).toEqual([{ id: "ghost" }]);
  });

  // A streaming session must use ITS OWN tab's model, not the global
  // active-tab value — otherwise switching tabs mid-stream hijacks the
  // background session's auto-continuation request with the wrong model.
  it("uses the session's own tab model, not the active-tab global", () => {
    useChatStore.setState({
      // Global reflects whatever tab is currently active (tab-active).
      model: "active/model",
      tabs: [
        { id: "tab-active", title: "A", model: "active/model", parallelCount: 1 },
        { id: "tab-bg", title: "B", model: "background/model", parallelCount: 1 },
      ],
      activeTabId: "tab-active",
    });

    const context = buildCanvasContext("tab-bg") as { model: string };

    expect(context.model).toBe("background/model");
  });

  it("falls back to the global model when no sessionId is given", () => {
    useChatStore.setState({ model: "test/model-z" });
    const context = buildCanvasContext() as { model: string };
    expect(context.model).toBe("test/model-z");
  });
});

describe("resolveChatApiUrl", () => {
  it("falls back to /api/chat when no env override is set", () => {
    // Test env has neither VITE_AI_API_URL nor VITE_DESIGN_AGENT_BACKEND_URL.
    clearChatApiEnv();
    expect(resolveChatApiUrl()).toBe("/api/chat");
  });
});

describe("useDesignChat (hook + UI message stream)", () => {
  beforeEach(() => {
    clearChatApiEnv();
    resetStores();
    seedScene();
    seedVariables();
  });

  function sseResponse(chunks: Array<Record<string, unknown>>): Response {
    const body =
      chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
      "data: [DONE]\n\n";
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
    });
  }

  // Regression: a background (non-active) session must send requests with ITS
  // OWN tab model — switching tabs (which moves the global model to the active
  // tab) must not hijack a streaming background session's request.
  it("sends with the session's own tab model, not the active-tab global", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return sseResponse([
        { type: "start" },
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "ok" },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    // The user is viewing tab-active; tab-bg is mid-conversation in the
    // background. The global model reflects the active tab.
    useChatStore.setState({
      model: "active/model",
      tabs: [
        { id: "tab-active", title: "A", model: "active/model", parallelCount: 1 },
        { id: "tab-bg", title: "B", model: "background/model", parallelCount: 1 },
      ],
      activeTabId: "tab-active",
    });

    const { result } = renderHook(() => useDesignChat({ sessionId: "tab-bg" }));
    act(() => result.current.setInput("continue in background"));
    await act(async () => {
      result.current.sendMessage();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(requests[0].model).toBe("background/model");
    expect(requests[0]).not.toHaveProperty("agentMode");
  });

  it("executes a streamed tool call locally and sends the output back", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        });
        if (requests.length === 1) {
          // First turn: the model calls get_variables
          return sseResponse([
            { type: "start" },
            { type: "start-step" },
            {
              type: "tool-input-available",
              toolCallId: "call-1",
              toolName: "get_variables",
              input: {},
            },
            { type: "finish-step" },
            { type: "finish" },
          ]);
        }
        // Second turn: the model answers with text
        return sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "All done" },
          { type: "text-end", id: "t1" },
          { type: "finish-step" },
          { type: "finish" },
        ]);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    // Must be stable across re-renders — useChat recreates the Chat (and
    // clears its messages) whenever the id changes.
    const sessionId = `test-session-${Date.now()}`;
    const { result } = renderHook(() => useDesignChat({ sessionId }));

    act(() => {
      result.current.setInput("list my variables");
    });
    await act(async () => {
      result.current.sendMessage();
    });

    // Tool output triggers an automatic follow-up request
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
      timeout: 5000,
    });
    await waitFor(() => expect(result.current.status).toBe("ready"), {
      timeout: 5000,
    });

    expect(requests[0].url).toBe("/api/chat");
    expect(requests[0].body.canvasContext).toBeTypeOf("string");
    expect(requests[0].body.model).toBeTypeOf("string");

    // The second request must contain the locally-executed tool result
    const secondMessages = requests[1].body.messages as Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;
    const assistant = secondMessages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    const toolPart = assistant!.parts.find(
      (p) => p.type === "tool-get_variables"
    );
    expect(toolPart).toBeDefined();
    expect(toolPart!.state).toBe("output-available");

    // Output is the real handler's serialization of the variable store
    const output = JSON.parse(String(toolPart!.output));
    expect(output.variables.map((v: { id: string }) => v.id)).toEqual([
      "var-primary",
      "var-radius",
    ]);

    // Trace-stitching contract (pen-editor-backend raw_traces.session_id):
    // every request of one conversation must carry the same non-empty id.
    expect(requests[0].body.id).toBeTypeOf("string");
    expect((requests[0].body.id as string).length).toBeGreaterThan(0);
    expect(requests[1].body.id).toBe(requests[0].body.id);

    // Final assistant message carries the streamed text
    const lastMessage = result.current.messages.at(-1);
    expect(lastMessage?.role).toBe("assistant");
    expect(
      lastMessage?.parts.some(
        (p) => p.type === "text" && p.text.includes("All done")
      )
    ).toBe(true);
  });

  it("does not auto-resolve ask_user; the turn pauses until addToolOutput", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { type: "start" },
        { type: "start-step" },
        {
          type: "tool-input-available",
          toolCallId: "call-ask",
          toolName: "ask_user",
          input: {
            questions: [
              { id: "audience", label: "Audience?", type: "single",
                options: [{ value: "devs", label: "Developers" }] },
            ],
          },
        },
        { type: "finish-step" },
        { type: "finish" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const sessionId = `ask-session-${Date.now()}`;
    const { result } = renderHook(() => useDesignChat({ sessionId }));

    act(() => result.current.setInput("design me a landing page"));
    await act(async () => {
      result.current.sendMessage();
    });

    // First (and only) request so far; ask_user must NOT trigger a follow-up.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Submitting the form answer resumes the turn.
    await act(async () => {
      result.current.addToolOutput({
        tool: "ask_user",
        toolCallId: "call-ask",
        output: JSON.stringify({ answers: [{ id: "audience", value: "devs" }] }),
      });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 5000 });
  });

  // Research mode streams backend-executed MCP (dynamic) tools. The AI SDK MCP
  // client tags each tool chunk with `toolMetadata`; the UI message stream
  // schema must accept it, or the whole stream is rejected with a
  // TypeValidationError and the tool call hangs forever on "Running…".
  it("accepts a dynamic MCP tool chunk carrying toolMetadata", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { type: "start" },
        { type: "start-step" },
        {
          type: "tool-input-start",
          toolCallId: "mcp-1",
          toolName: "refero_search_screens",
          dynamic: true,
        },
        {
          type: "tool-input-available",
          toolCallId: "mcp-1",
          toolName: "refero_search_screens",
          input: { query: "onboarding", platform: "web" },
          providerMetadata: { openrouter: { reasoning_details: [] } },
          toolMetadata: { clientName: "ai-sdk-mcp-client" },
          dynamic: true,
          title: "refero_search_screens",
        },
        {
          type: "tool-output-available",
          toolCallId: "mcp-1",
          output: { screens: [{ id: "s1" }] },
          dynamic: true,
        },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Found some screens" },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish" },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const sessionId = `test-session-mcp-${Date.now()}`;
    const { result } = renderHook(() => useDesignChat({ sessionId }));

    act(() => {
      result.current.setInput("find onboarding screens");
    });
    await act(async () => {
      result.current.sendMessage();
    });

    // The stream must parse cleanly — no TypeValidationError on toolMetadata.
    await waitFor(() => expect(result.current.status).toBe("ready"), {
      timeout: 5000,
    });
    expect(result.current.error).toBeUndefined();

    const assistant = result.current.messages.at(-1);
    expect(assistant?.role).toBe("assistant");
    const toolPart = assistant?.parts.find(
      (p) => p.type === "dynamic-tool"
    ) as { state?: string; toolName?: string } | undefined;
    expect(toolPart).toBeDefined();
    expect(toolPart!.toolName).toBe("refero_search_screens");
    expect(toolPart!.state).toBe("output-available");
  });

  it("fails locally without a network request when offline", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: false });

    const sessionId = `test-session-offline-${Date.now()}`;
    const { result } = renderHook(() => useDesignChat({ sessionId }));

    act(() => {
      result.current.setInput("do something");
    });
    act(() => {
      const didSend = result.current.sendMessage();
      expect(didSend).toBe(false);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error?.message).toMatch(/offline/i);
    // The unsent draft is preserved so the user can retry once back online.
    expect(result.current.input).toBe("do something");

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeUndefined();
  });

  // Regression: a parallel-tab launch (ChatPanel.handleSubmit -> queueLaunchPayload
  // for extra tabs) used to be consumed from the store the instant the tab's
  // useDesignChat mounted, even while offline — sendPayload's offline guard
  // then rejected it, and the one-shot consumeLaunchPayload had already
  // deleted it, destroying the queued message permanently.
  it("keeps a queued launch payload queued while offline, and sends it once back online", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { type: "start" },
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "ok" },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish" },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);
    const nav = { onLine: false };
    vi.stubGlobal("navigator", nav);

    const sessionId = `test-session-queued-${Date.now()}`;
    useChatStore.getState().queueLaunchPayload(sessionId, {
      text: "queued while offline",
    });

    renderHook(() => useDesignChat({ sessionId }));

    // Give the mount effect a tick to (not) run, then assert the payload was
    // neither sent nor deleted from the queue.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().launchQueue[sessionId]).toEqual({
      text: "queued while offline",
    });

    // Connectivity returns — the effect re-runs (isOnline dependency) and
    // consumes+sends the still-queued payload.
    nav.onLine = true;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(useChatStore.getState().launchQueue[sessionId]).toBeUndefined();
  });

  // RTL's `waitFor` polls via `setInterval`, which is itself mocked once
  // `vi.useFakeTimers()` is active — nothing ever advances it, so a plain
  // `waitFor` hangs until the test timeout. Poll manually instead, ticking
  // the fake clock a little each iteration so pending microtasks (e.g. the
  // rejected-fetch retry catch handler) get a chance to flush.
  async function waitForFakeTimers(
    assertion: () => void,
    { timeoutMs = 2000, stepMs = 10 }: { timeoutMs?: number; stepMs?: number } = {},
  ): Promise<void> {
    let elapsed = 0;
    for (;;) {
      try {
        assertion();
        return;
      } catch (err) {
        if (elapsed >= timeoutMs) {
          throw err;
        }
        await act(async () => {
          await vi.advanceTimersByTimeAsync(stepMs);
        });
        elapsed += stepMs;
      }
    }
  }

  it("auto-retries network failures and recovers, exposing retryState", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementationOnce(async () =>
        sseResponse([
          { type: "start" },
          { type: "start-step" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "recovered" },
          { type: "text-end", id: "t1" },
          { type: "finish-step" },
          { type: "finish" },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDesignChat({ sessionId: "s1" }));
    expect(result.current.retryState).toBeNull();

    act(() => result.current.setInput("hello"));
    await act(async () => {
      result.current.sendMessage();
    });

    await waitForFakeTimers(() =>
      expect(result.current.retryState).toEqual({ attempt: 1, maxAttempts: 3 }),
    );
    // No red error while retrying.
    expect(result.current.error).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await waitForFakeTimers(() =>
      expect(result.current.retryState).toEqual({ attempt: 2, maxAttempts: 3 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    await waitForFakeTimers(() => expect(result.current.retryState).toBeNull());
    await waitForFakeTimers(() => {
      const assistant = result.current.messages.find((m) => m.role === "assistant");
      expect(assistant).toBeDefined();
    });
    expect(result.current.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // Regression coverage for the "chat message queue" feature: sending while
  // the agent is busy (status "submitted"/"streaming") must not drop the
  // message — it goes into chatStore's messageQueue and is auto-sent, one at
  // a time, once the session returns to "ready".
  describe("message queue", () => {
    it("queues sendPayload calls made while a request is in flight, and auto-sends the first once ready", async () => {
      let resolveFirst: ((res: Response) => void) | undefined;
      const firstResponse = new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      });
      const requests: Array<Record<string, unknown>> = [];
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body));
          requests.push(body);
          if (requests.length === 1) {
            return firstResponse;
          }
          return sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t2" },
            { type: "text-delta", id: "t2", delta: "second reply" },
            { type: "text-end", id: "t2" },
            { type: "finish-step" },
            { type: "finish" },
          ]);
        }
      );
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `queue-session-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => result.current.setInput("first message"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      // Still mid-flight — the first request hasn't resolved yet.
      expect(["submitted", "streaming"]).toContain(result.current.status);

      // A second send while busy must be accepted (queued), not dropped.
      // Exercised via submitLaunchPayload (what ChatInput's onSubmit calls),
      // rather than sendMessage/input, since the first send already cleared
      // `input`.
      let queuedOk = false;
      act(() => {
        queuedOk = result.current.submitLaunchPayload({ text: "second message" });
      });
      expect(queuedOk).toBe(true);

      expect(useChatStore.getState().messageQueue[sessionId]).toHaveLength(1);
      expect(
        useChatStore.getState().messageQueue[sessionId]?.[0].payload.text
      ).toBe("second message");
      expect(result.current.queuedMessages).toHaveLength(1);
      expect(result.current.queuedMessages[0].payload.text).toBe("second message");
      // Only one network request has gone out so far — the queued message
      // was NOT sent immediately.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Resolve the first (in-flight) request; the session returns to
      // "ready", which should auto-send the queued message.
      await act(async () => {
        resolveFirst!(
          sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "first reply" },
            { type: "text-end", id: "t1" },
            { type: "finish-step" },
            { type: "finish" },
          ])
        );
      });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
        timeout: 5000,
      });
      await waitFor(() => expect(result.current.status).toBe("ready"), {
        timeout: 5000,
      });

      // The queue is drained.
      expect(useChatStore.getState().messageQueue[sessionId]).toBeUndefined();
      expect(result.current.queuedMessages).toHaveLength(0);
    });

    // Regression for FIX 1: the auto-drain effect must peek the queue and
    // only remove the item once sendPayload actually succeeds. Previously it
    // dequeued (removed) first and sent second, so a `false` return (e.g. an
    // offline race) silently lost the message forever.
    it("keeps a queued message in the queue when sendPayload fails, and sends it once the condition clears", async () => {
      let resolveFirst: ((res: Response) => void) | undefined;
      const firstResponse = new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      });
      const requests: Array<Record<string, unknown>> = [];
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body));
          requests.push(body);
          if (requests.length === 1) {
            return firstResponse;
          }
          return sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t2" },
            { type: "text-delta", id: "t2", delta: "second reply" },
            { type: "text-end", id: "t2" },
            { type: "finish-step" },
            { type: "finish" },
          ]);
        }
      );
      vi.stubGlobal("fetch", fetchMock);
      // Control connectivity through a stubbed navigator (whose `onLine` the
      // live `isOffline()` check reads) plus the "offline"/"online" events
      // that drive useOnlineStatus's `isOnline` state — keeping the two in
      // sync, exactly as a real browser does.
      const nav = { onLine: true };
      vi.stubGlobal("navigator", nav);

      const sessionId = `queue-offline-race-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => result.current.setInput("first message"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(["submitted", "streaming"]).toContain(result.current.status);

      act(() => {
        result.current.submitLaunchPayload({ text: "second message" });
      });
      expect(useChatStore.getState().messageQueue[sessionId]).toHaveLength(1);
      const queuedId = useChatStore.getState().messageQueue[sessionId]![0].id;

      // Go offline before the in-flight request settles: nav.onLine flips and
      // the "offline" event flips useOnlineStatus's isOnline to false.
      act(() => {
        nav.onLine = false;
        window.dispatchEvent(new Event("offline"));
      });
      await act(async () => {
        resolveFirst!(
          sseResponse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "first reply" },
            { type: "text-end", id: "t1" },
            { type: "finish-step" },
            { type: "finish" },
          ])
        );
      });
      await waitFor(() => expect(result.current.status).toBe("ready"));

      // Session is "ready" but offline — the drain effect bails before any
      // send, so the message must still be in the queue, with its original
      // id, not lost.
      expect(useChatStore.getState().messageQueue[sessionId]).toHaveLength(1);
      expect(useChatStore.getState().messageQueue[sessionId]![0].id).toBe(queuedId);
      expect(useChatStore.getState().messageQueue[sessionId]![0].payload.text).toBe(
        "second message"
      );
      // Only the first request has gone out — the queued one was never sent.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Connectivity genuinely returns — the "online" event flips `isOnline`
      // back to true, the effect reruns, and the still-queued message is
      // finally sent.
      act(() => {
        nav.onLine = true;
        window.dispatchEvent(new Event("online"));
      });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
        timeout: 5000,
      });
      expect(requests[1].messages).toBeDefined();
      await waitFor(() =>
        expect(useChatStore.getState().messageQueue[sessionId]).toBeUndefined()
      );
    });

    it("removeQueuedMessage removes an item before it gets auto-sent", async () => {
      // A request that never resolves keeps the session in "submitted" so
      // the queued item is never auto-drained during this test.
      const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
      vi.stubGlobal("fetch", fetchMock);

      const sessionId = `queue-remove-session-${Date.now()}`;
      const { result } = renderHook(() => useDesignChat({ sessionId }));

      act(() => result.current.setInput("first message"));
      await act(async () => {
        result.current.sendMessage();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(["submitted", "streaming"]).toContain(result.current.status);

      act(() => {
        result.current.submitLaunchPayload({ text: "will be removed" });
      });
      expect(result.current.queuedMessages).toHaveLength(1);
      const id = result.current.queuedMessages[0].id;

      act(() => result.current.removeQueuedMessage(id));

      expect(result.current.queuedMessages).toHaveLength(0);
      expect(useChatStore.getState().messageQueue[sessionId]).toBeUndefined();
    });
  });

  it("surfaces the error and clears retryState after retries are exhausted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDesignChat({ sessionId: "s1" }));
    act(() => result.current.setInput("hello"));
    await act(async () => {
      result.current.sendMessage();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000); // 3 pauses
    });

    await waitForFakeTimers(() => expect(result.current.error).toBeDefined());
    expect(result.current.retryState).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 retries
  });
});
