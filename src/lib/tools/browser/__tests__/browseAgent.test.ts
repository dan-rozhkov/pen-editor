import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolHandlers, type ToolHandler } from "@/lib/toolRegistry";
import { clearOpenCodeKey, setOpenCodeKey } from "@/lib/opencodeKey";
import { useChatStore } from "@/store/chatStore";
import { BROWSE_AGENT_DEADLINE_MS, BROWSE_AGENT_OPENCODE_MODEL, browseAgent, nestedChatId } from "../browseAgent";

type Chunk = Record<string, unknown>;

function sse(chunks: Chunk[]): Response {
  const body = [...chunks, "[DONE]"]
    .map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
  });
}

const toolTurn = (toolName: string, input: unknown, toolCallId = "call-1"): Response =>
  sse([
    { type: "start" },
    { type: "start-step" },
    { type: "tool-input-available", toolCallId, toolName, input },
    { type: "finish-step" },
    { type: "finish" },
  ]);

const textTurn = (text: string): Response =>
  sse([
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish-step" },
    { type: "finish" },
  ]);

interface Captured {
  body: Record<string, unknown>;
  headers: Headers;
}

/** Stubs global fetch with one scripted response per call; records requests. */
function stubFetch(script: Array<() => Response | Promise<Response>>) {
  const captured: Captured[] = [];
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    const next = script[captured.length - 1];
    if (!next) throw new Error("unexpected extra request");
    return next();
  });
  vi.stubGlobal("fetch", fetchMock);
  return captured;
}

/** Sets the model of chat "chat-1" (the parent session used in these tests). */
function setChatModel(model: string) {
  const [first] = useChatStore.getState().chats;
  useChatStore.setState({ model, chats: [{ ...first, id: "chat-1", model }] });
}

let saved: Record<string, ToolHandler | undefined>;
const stubbed = ["browse_open", "batch_design"];

beforeEach(() => {
  setChatModel("google/gemini-2.5-flash");
  saved = Object.fromEntries(stubbed.map((n) => [n, toolHandlers[n]]));
  clearOpenCodeKey();
});

afterEach(() => {
  for (const n of stubbed) {
    if (saved[n]) toolHandlers[n] = saved[n];
    else delete toolHandlers[n];
  }
  clearOpenCodeKey();
  vi.unstubAllGlobals();
});

describe("browse_agent", () => {
  it("runs a nested browse session under the parent session id", async () => {
    const open = vi.fn(async () => JSON.stringify({ ok: true }));
    toolHandlers.browse_open = open;
    const captured = stubFetch([
      () => toolTurn("browse_open", { url: "https://example.com/p" }),
      () => textTurn("  The price is 5 USD. https://example.com/p  "),
    ]);

    const raw = await browseAgent(
      { goal: "Find the price", url: "https://example.com" },
      { sessionId: "chat-1", toolCallId: "tc-9" },
    );

    expect(JSON.parse(raw)).toEqual({
      status: "done",
      answer: "The price is 5 USD. https://example.com/p",
      steps: 2,
    });
    expect(open).toHaveBeenCalledTimes(2);
    // The start page opens before the first request; every executed tool is
    // bound to the PARENT session (same browser + loop guard).
    expect(open.mock.calls[0]).toEqual([
      { url: "https://example.com" },
      expect.objectContaining({ sessionId: "chat-1", toolCallId: "tc-9:open" }),
    ]);
    expect(open.mock.calls[1]).toEqual([
      { url: "https://example.com/p" },
      expect.objectContaining({ sessionId: "chat-1", toolCallId: "call-1" }),
    ]);
    expect(captured).toHaveLength(2);
    for (const { body, headers } of captured) {
      expect(body.agentMode).toBe("browse");
      expect(body).not.toHaveProperty("canvasContext");
      expect(body).not.toHaveProperty("model");
      expect(body.clientCapabilities).toBeDefined();
      expect(body.id).toBe(nestedChatId("chat-1", "tc-9"));
      expect(headers.get("X-OpenCode-Key")).toBeNull();
    }
    const first = (captured[0].body.messages as Array<{ parts: Array<{ text?: string }> }>)[0];
    expect(first.parts[0].text).toContain("Find the price");
    expect(first.parts[0].text).toContain("https://example.com");
    // The pre-open result rides in the first message.
    expect(first.parts[0].text).toContain('{"ok":true}');
  });

  it("pins the OpenCode model and sends the key header for an opencode-go chat model with a key", async () => {
    // Key first: changing it re-runs reconcileModels, which resets models
    // the (empty, in tests) backend list does not offer.
    setOpenCodeKey("sk-test");
    setChatModel("opencode-go/glm-5");
    const captured = stubFetch([() => textTurn("ok")]);

    const raw = await browseAgent({ goal: "x" }, { sessionId: "chat-1", toolCallId: "tc-1" });

    expect(JSON.parse(raw).status).toBe("done");
    expect(captured[0].body.model).toBe(BROWSE_AGENT_OPENCODE_MODEL);
    expect(captured[0].headers.get("X-OpenCode-Key")).toBe("sk-test");
  });

  it.each([
    ["an OpenRouter chat model with a stored key", () => { setOpenCodeKey("sk-test"); setChatModel("google/gemini-2.5-flash"); }],
    ["a Zen chat model with a stored key", () => { setOpenCodeKey("sk-test"); setChatModel("opencode/big-pickle"); }],
    ["an opencode-go chat model without a key", () => setChatModel("opencode-go/glm-5")],
  ])("sends no model for %s", async (_label, prepare) => {
    prepare();
    const captured = stubFetch([() => textTurn("ok")]);

    await browseAgent({ goal: "x" }, { sessionId: "chat-1", toolCallId: "tc-1" });

    expect(captured[0].body).not.toHaveProperty("model");
    expect(captured[0].headers.get("X-OpenCode-Key")).toBeNull();
  });

  it("returns step_limit with all assistant text, including text between tool calls", async () => {
    toolHandlers.browse_open = vi.fn(async () => JSON.stringify({ ok: true }));
    const textThenTool = (text: string, id: string) =>
      sse([
        { type: "start" },
        { type: "start-step" },
        { type: "text-start", id: `t-${id}` },
        { type: "text-delta", id: `t-${id}`, delta: text },
        { type: "text-end", id: `t-${id}` },
        { type: "tool-input-available", toolCallId: id, toolName: "browse_open", input: { url: "https://e.com" } },
        { type: "finish-step" },
        { type: "finish" },
      ]);
    stubFetch(Array.from({ length: 70 }, (_, i) => () => textThenTool(`note ${i}`, `c${i}`)));

    const result = JSON.parse(
      await browseAgent({ goal: "x" }, { sessionId: "chat-1", toolCallId: "tc-1" }),
    );

    expect(result.status).toBe("step_limit");
    expect(result.answer).toContain("note 0");
    expect(result.answer).toContain("note 1\n\n");
    expect(result.answer.length).toBeLessThanOrEqual(8000);
  });

  it("returns timeout with the partial answer when its own deadline fires", async () => {
    vi.useFakeTimers();
    try {
      toolHandlers.browse_open = vi.fn(async () => JSON.stringify({ ok: true }));
      const calls: number[] = [];
      stubFetch([
        () =>
          sse([
            { type: "start" },
            { type: "start-step" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "partial finding" },
            { type: "text-end", id: "t1" },
            { type: "tool-input-available", toolCallId: "c1", toolName: "browse_open", input: { url: "https://e.com" } },
            { type: "finish-step" },
            { type: "finish" },
          ]),
        () => {
          calls.push(1);
          return new Promise<Response>(() => {}); // hangs forever
        },
      ]);

      const run = browseAgent({ goal: "x" }, { sessionId: "chat-1", toolCallId: "tc-1" });
      await vi.advanceTimersByTimeAsync(BROWSE_AGENT_DEADLINE_MS + 1);
      const result = JSON.parse(await run);

      expect(result.status).toBe("timeout");
      expect(result.answer).toBe("partial finding");
      expect(result.steps).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns aborted when the parent signal fires mid-run", async () => {
    const abort = new AbortController();
    toolHandlers.browse_open = vi.fn(async () => {
      abort.abort();
      return JSON.stringify({ ok: true });
    });
    stubFetch([
      () => toolTurn("browse_open", { url: "https://example.com" }),
      () => textTurn("should not matter"),
    ]);

    const raw = await browseAgent(
      { goal: "x" },
      { sessionId: "chat-1", toolCallId: "tc-1", signal: abort.signal },
    );

    expect(JSON.parse(raw).status).toBe("aborted");
  });

  it("answers a non-browse tool call with an error output and does not execute it", async () => {
    const batch = vi.fn(async () => "executed");
    toolHandlers.batch_design = batch;
    const captured = stubFetch([
      () => toolTurn("batch_design", { operations: "" }),
      () => textTurn("sorry"),
    ]);

    const raw = await browseAgent({ goal: "x" }, { sessionId: "chat-1", toolCallId: "tc-1" });

    expect(batch).not.toHaveBeenCalled();
    expect(JSON.parse(raw)).toMatchObject({ status: "done", steps: 0 });
    const messages = captured[1].body.messages as Array<{
      parts: Array<{ type: string; output?: unknown }>;
    }>;
    const toolPart = messages.flatMap((m) => m.parts).find((p) => p.type === "tool-batch_design");
    expect(String(toolPart?.output)).toContain("not available to the browse agent");
  });

  it("reports an HTTP error as status error with a short message", async () => {
    stubFetch([
      () =>
        new Response(JSON.stringify({ error: "opencode_key_required" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    ]);

    const raw = await browseAgent({ goal: "x" }, { sessionId: "chat-1", toolCallId: "tc-1" });
    const result = JSON.parse(raw);

    expect(result.status).toBe("error");
    expect(result.error).toContain("opencode_key_required");
    expect(result.error.length).toBeLessThanOrEqual(300);
  });

  it("rejects an empty goal without a request", async () => {
    const captured = stubFetch([]);
    const raw = await browseAgent({}, { sessionId: "chat-1" });
    expect(JSON.parse(raw).status).toBe("error");
    expect(captured).toHaveLength(0);
  });
});

describe("nestedChatId", () => {
  it("keeps only safe characters and caps the length", () => {
    const id = nestedChatId("a b/c", `x${"y".repeat(400)}`);
    expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(id.length).toBeLessThanOrEqual(200);
  });
});
