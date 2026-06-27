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

  it("serializes scene roots, selection, variables, model and agent mode", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] });
    useChatStore.setState({ model: "test/model-x", agentMode: "edits" });

    const context = buildCanvasContext() as {
      canvasContext: string;
      model: string;
      agentMode: string;
    };

    expect(context.model).toBe("test/model-x");
    expect(context.agentMode).toBe("edits");

    const canvas = JSON.parse(context.canvasContext);
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

  // A streaming session must use ITS OWN tab's model/agentMode, not the global
  // active-tab values — otherwise switching tabs mid-stream hijacks the
  // background session's auto-continuation request with the wrong model/mode.
  it("uses the session's own tab model/agentMode, not the active-tab global", () => {
    useChatStore.setState({
      // Global reflects whatever tab is currently active (tab-active).
      model: "active/model",
      agentMode: "research",
      tabs: [
        { id: "tab-active", title: "A", model: "active/model", agentMode: "research", parallelCount: 1 },
        { id: "tab-bg", title: "B", model: "background/model", agentMode: "prototype", parallelCount: 1 },
      ],
      activeTabId: "tab-active",
    });

    const context = buildCanvasContext("tab-bg") as {
      model: string;
      agentMode: string;
    };

    expect(context.model).toBe("background/model");
    expect(context.agentMode).toBe("prototype");
  });

  it("falls back to the global model/agentMode when no sessionId is given", () => {
    useChatStore.setState({ model: "test/model-z", agentMode: "edits" });
    const context = buildCanvasContext() as { model: string; agentMode: string };
    expect(context.model).toBe("test/model-z");
    expect(context.agentMode).toBe("edits");
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
      agentMode: "research",
      tabs: [
        { id: "tab-active", title: "A", model: "active/model", agentMode: "research", parallelCount: 1 },
        { id: "tab-bg", title: "B", model: "background/model", agentMode: "prototype", parallelCount: 1 },
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
    expect(requests[0].agentMode).toBe("prototype");
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

    // Final assistant message carries the streamed text
    const lastMessage = result.current.messages.at(-1);
    expect(lastMessage?.role).toBe("assistant");
    expect(
      lastMessage?.parts.some(
        (p) => p.type === "text" && p.text.includes("All done")
      )
    ).toBe(true);
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
});
