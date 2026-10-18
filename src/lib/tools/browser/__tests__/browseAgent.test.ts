import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolHandlers, type ToolHandler } from "@/lib/toolRegistry";
import { clearOpenCodeKey, setOpenCodeKey } from "@/lib/opencodeKey";
import { useChatStore } from "@/store/chatStore";
import { sse, textTurn, setPenDesktop, stubBrowser, type PenDesktopBrowser } from "./helpers";
import { BROWSE_AGENT_DEADLINE_MS, browseAgent, nestedChatId } from "../browseAgent";

const toolTurn = (toolName: string, input: unknown, toolCallId = "call-1"): Response =>
  sse([
    { type: "start" },
    { type: "start-step" },
    { type: "tool-input-available", toolCallId, toolName, input },
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
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // The checkpoint journal talks to the cloud browser: not a chat request, no script entry.
    if (String(input).includes("/api/browser/")) {
      return new Response(JSON.stringify({ result: { error: "no cloud browser in this test" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
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
const stubbed = ["browse_open", "browse_capture", "browse_fill_login", "batch_design"];

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

/** The output the nested chat sent back for one tool call, read from request `turn`. */
function outputOf(captured: Captured[], turn: number, toolCallId: string): string {
  const msgs = captured[turn].body.messages as Array<{ parts: Array<Record<string, unknown>> }>;
  return msgs.flatMap((m) => m.parts).find((p) => p.toolCallId === toolCallId)?.output as string;
}

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

  describe("browse_capture gate", () => {
    const run = (capture?: boolean) =>
      browseAgent({ goal: "copy it", ...(capture === undefined ? {} : { capture }) }, { sessionId: "chat-1", toolCallId: "tc-1" });

    it("flag off: no browseCapture in the body and the tool is refused", async () => {
      const capture = vi.fn(async () => JSON.stringify({ nodeId: "n1" }));
      toolHandlers.browse_capture = capture;
      const captured = stubFetch([() => toolTurn("browse_capture", {}), () => textTurn("done")]);
      const result = JSON.parse(await run());
      expect(captured[0].body).not.toHaveProperty("browseCapture");
      expect(capture).not.toHaveBeenCalled();
      expect(JSON.stringify(outputOf(captured, 1, "call-1"))).toContain("not available to the browse agent");
      expect(result).not.toHaveProperty("captured");
    });

    it("flag on: body carries browseCapture, first capture runs, second is refused, result has captured", async () => {
      const info = { nodeId: "n1", width: 10, height: 20, url: "https://e.com", title: "E" };
      const capture = vi.fn(async () => JSON.stringify(info));
      toolHandlers.browse_capture = capture;
      const captured = stubFetch([
        () => toolTurn("browse_capture", {}, "c1"),
        () => toolTurn("browse_capture", {}, "c2"),
        () => textTurn("copied"),
      ]);
      const result = JSON.parse(await run(true));
      expect(captured.every((c) => c.body.browseCapture === true)).toBe(true);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(outputOf(captured, 2, "c2"))).toContain(
        "browse_capture already ran in this task; the page is on the canvas as n1.",
      );
      expect(result.captured).toEqual(info);
    });

    it("a failed (aborted/timed-out) capture leaves the gate idle, so a retry runs", async () => {
      const info = { nodeId: "n2", width: 1, height: 2, url: "", title: "" };
      const capture = vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify({ error: "browse_capture was aborted or timed out; nothing was added." }))
        .mockResolvedValueOnce(JSON.stringify(info));
      toolHandlers.browse_capture = capture;
      stubFetch([
        () => toolTurn("browse_capture", {}, "c1"),
        () => toolTurn("browse_capture", {}, "c2"),
        () => textTurn("copied"),
      ]);
      const result = JSON.parse(await run(true));
      expect(capture).toHaveBeenCalledTimes(2);
      expect(result.captured).toEqual(info);
    });
  });

  describe("browse_fill_login gate", () => {
    const run = () => browseAgent({ goal: "sign in" }, { sessionId: "chat-1", toolCallId: "tc-1" });

    afterEach(() => {
      delete window.penDesktop;
    });

    it("desktop bridge without fillLogin: no browseLogin, the tool is refused", async () => {
      setPenDesktop(stubBrowser());
      const fill = vi.fn(async () => "{}");
      toolHandlers.browse_fill_login = fill;
      const captured = stubFetch([() => toolTurn("browse_fill_login", {}), () => textTurn("done")]);
      await run();
      expect(captured[0].body).not.toHaveProperty("browseLogin");
      expect(fill).not.toHaveBeenCalled();
    });

    it("web (no desktop bridge): no browseLogin", async () => {
      const captured = stubFetch([() => textTurn("done")]);
      await run();
      expect(captured[0].body).not.toHaveProperty("browseLogin");
    });

    it("desktop bridge with fillLogin: body carries browseLogin and the tool may be called repeatedly", async () => {
      setPenDesktop(stubBrowser({ fillLogin: async () => ({ ok: true }) } as Partial<PenDesktopBrowser>));
      const fill = vi.fn(async () => JSON.stringify({ ok: true }));
      toolHandlers.browse_fill_login = fill;
      const captured = stubFetch([
        () => toolTurn("browse_fill_login", {}, "l1"),
        () => toolTurn("browse_fill_login", {}, "l2"),
        () => textTurn("signed in"),
      ]);
      await run();
      expect(captured.every((c) => c.body.browseLogin === true)).toBe(true);
      expect(fill).toHaveBeenCalledTimes(2);
    });
  });

  it("a failing pre-open reaches the model as an error text instead of throwing", async () => {
    toolHandlers.browse_open = vi.fn(async () => {
      throw new Error("no browser");
    });
    const captured = stubFetch([() => textTurn("ok")]);
    const result = JSON.parse(
      await browseAgent({ goal: "go", url: "https://example.com" }, { sessionId: "chat-1", toolCallId: "tc-2" }),
    );
    expect(result).toEqual({ status: "done", answer: "ok", steps: 1 });
    const first = (captured[0].body.messages as Array<{ parts: Array<{ text?: string }> }>)[0];
    expect(first.parts[0].text).toContain('{"error":"no browser"}');
  });

  it.each([
    ["an opencode-go chat model with a stored key", () => { setOpenCodeKey("sk-test"); setChatModel("opencode-go/glm-5"); }],
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

describe("browse_agent QA mode", () => {
  const run = (qa?: boolean) =>
    browseAgent({ goal: "Check the cart", ...(qa === undefined ? {} : { qa }) }, { sessionId: "chat-1", toolCallId: "tc-q" });

  it("qa on: browseQa in the body, the verdict ends the run, qa folded into the result", async () => {
    const open = vi.fn(async () => JSON.stringify({ ok: true }));
    toolHandlers.browse_open = open;
    // A handler for qa_verdict must NOT be needed: the verdict runs locally.
    const verdictHandler = vi.fn(async () => "bridge");
    const savedVerdict = toolHandlers.qa_verdict;
    toolHandlers.qa_verdict = verdictHandler;
    const captured = stubFetch([
      () => toolTurn("browse_open", { url: "https://shop.test/cart" }, "c1"),
      () => toolTurn("qa_verdict", { verdict: "pass", reason: "cart shows 3 items" }, "c2"),
      // A third request would throw "unexpected extra request".
    ]);
    try {
      const out = JSON.parse(await run(true));
      expect(captured).toHaveLength(2);
      for (const { body } of captured) expect(body.browseQa).toBe(true);
      expect(verdictHandler).not.toHaveBeenCalled();
      expect(out).not.toHaveProperty("qaVerdict");
      expect(out.status).toBe("done");
      expect(out.qa).toMatchObject({ outcome: "passed", verdict: "pass", reason: "cart shows 3 items" });
      expect(out.qa.steps.map((st: { tool: string }) => st.tool)).toEqual(["browse_open", "qa_verdict"]);
      expect(out.qa.steps[0]).toMatchObject({ index: 1, ok: true });
      expect(Object.keys(out).indexOf("qa")).toBeGreaterThan(Object.keys(out).indexOf("steps"));
    } finally {
      if (savedVerdict) toolHandlers.qa_verdict = savedVerdict;
    }
  });

  it("qa on: a verdict with bad input is an error and does not end the run", async () => {
    toolHandlers.browse_open = vi.fn(async () => JSON.stringify({ ok: true }));
    const captured = stubFetch([
      () => toolTurn("qa_verdict", { verdict: "maybe", reason: "" }, "c1"),
      () => toolTurn("qa_verdict", { verdict: "fail", reason: "no items" }, "c2"),
    ]);
    const out = JSON.parse(await run(true));
    expect(captured).toHaveLength(2);
    expect(JSON.parse(outputOf(captured, 1, "c1")).error).toContain("qa_verdict");
    expect(out.qa).toMatchObject({ outcome: "failed", verdict: "fail", reason: "no items" });
    expect(out.qa.steps[0]).toMatchObject({ tool: "qa_verdict", ok: false });
  });

  const assertThenVerdict = () =>
    stubFetch([
      () => toolTurn("qa_assert", { checks: [{ type: "text", text: "Hello" }] }, "c1"),
      () => toolTurn("qa_verdict", { verdict: "pass", reason: "ok" }, "c2"),
    ]);

  const assertAnswer = (passed: boolean, extra: Record<string, unknown> = {}) => ({
    ok: true,
    passed,
    results: [{ check: { type: "text", text: "Hello" }, passed, ...(passed ? {} : { actual: "not found" }) }],
    ...extra,
  });

  it("qa_assert goes to bridge.assert, is recorded, and does not end the run", async () => {
    const assert = vi.fn(async () => assertAnswer(true, { consoleErrors: ["TypeError: x"] }));
    setPenDesktop(stubBrowser({ assert }));
    const captured = assertThenVerdict();
    const out = JSON.parse(await run(true));
    expect(assert).toHaveBeenCalledTimes(1);
    expect(assert).toHaveBeenCalledWith({ checks: [{ type: "text", text: "Hello" }] });
    expect(JSON.parse(outputOf(captured, 1, "c1"))).toMatchObject({ passed: true });
    expect(out.qa.outcome).toBe("passed");
    expect(out.qa.checks).toEqual([expect.objectContaining({ source: "agent", passed: true })]);
    expect(out.qa.consoleErrors).toEqual(["TypeError: x"]);
    expect(out.qa.steps.map((st: { tool: string }) => st.tool)).toEqual(["qa_assert", "qa_verdict"]);
  });

  it("final checks flip passed to failed and appear in the JSON with the new fields", async () => {
    const assert = vi.fn(async () => assertAnswer(false, { failedRequests: ["GET 500 https://x.test/api"] }));
    setPenDesktop(stubBrowser({ assert }));
    stubFetch([() => toolTurn("qa_verdict", { verdict: "pass", reason: "looks fine" }, "c1")]);
    const out = JSON.parse(
      await browseAgent(
        { goal: "g", qa: true, checks: [{ type: "text", text: "Hello" }] },
        { sessionId: "chat-1", toolCallId: "tc-q" },
      ),
    );
    expect(assert).toHaveBeenCalledTimes(1);
    expect(out.qa.outcome).toBe("failed");
    expect(out.qa.reason).toContain("Final check failed");
    expect(out.qa.checks).toEqual([expect.objectContaining({ source: "final", passed: false })]);
    expect(out.qa.failedRequests).toEqual(["GET 500 https://x.test/api"]);
  });

  it("invalid checks are an input error before any request", async () => {
    const captured = stubFetch([]);
    const out = JSON.parse(await browseAgent({ goal: "g", qa: true, checks: [{ type: "nope" }] }, { sessionId: "chat-1" }));
    expect(out.status).toBe("error");
    expect(out.error).toContain("checks");
    expect(captured).toHaveLength(0);
  });

  it("checks without qa: true is an input error, not dropped", async () => {
    const captured = stubFetch([]);
    const out = JSON.parse(await browseAgent({ goal: "g", checks: [{ type: "text", text: "Hello" }] }, { sessionId: "chat-1" }));
    expect(out.status).toBe("error");
    expect(out.error).toContain("qa: true");
    expect(captured).toHaveLength(0);
  });

  it("a desktop bridge without assert: checks are an input error", async () => {
    setPenDesktop(stubBrowser());
    const captured = stubFetch([]);
    const out = JSON.parse(await browseAgent({ goal: "g", qa: true, checks: [{ type: "text", text: "Hello" }] }, { sessionId: "chat-1" }));
    expect(out.error).toBe("Final checks need a browser that supports assertions.");
    expect(captured).toHaveLength(0);
  });

  it("the nested turn sends browseAssert only when the bridge has assert", async () => {
    setPenDesktop(stubBrowser());
    let captured = stubFetch([() => textTurn("done")]);
    await run(true);
    expect((captured[0].body.clientCapabilities as { browseAssert: boolean }).browseAssert).toBe(false);
    setPenDesktop(stubBrowser({ assert: async () => assertAnswer(true) }));
    captured = stubFetch([() => textTurn("done")]);
    await run(true);
    expect((captured[0].body.clientCapabilities as { browseAssert: boolean }).browseAssert).toBe(true);
  });

  it("qa_assert is not callable when the bridge has no assert", async () => {
    setPenDesktop(stubBrowser());
    const captured = assertThenVerdict();
    const out = JSON.parse(await run(true));
    expect(JSON.parse(outputOf(captured, 1, "c1")).error).toBeTruthy();
    expect(out.qa.checks ?? []).toEqual([]);
  });

  it("a hung qa_assert is cut at the timeout", async () => {
    vi.useFakeTimers();
    try {
      setPenDesktop(stubBrowser({ assert: () => new Promise(() => {}) }));
      const captured = stubFetch([
        () => toolTurn("qa_assert", { checks: [{ type: "text", text: "Hello" }] }, "c1"),
        () => toolTurn("qa_verdict", { verdict: "pass", reason: "ok" }, "c2"),
      ]);
      const p = run(true);
      await vi.advanceTimersByTimeAsync(31_000);
      await p;
      expect(JSON.parse(outputOf(captured, 1, "c1")).error).toContain("timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an aborted run does not wait for a hung qa_assert", async () => {
    const ac = new AbortController();
    setPenDesktop(stubBrowser({ assert: () => { queueMicrotask(() => ac.abort()); return new Promise(() => {}); } }));
    stubFetch([
      () => toolTurn("qa_assert", { checks: [{ type: "text", text: "Hello" }] }, "c1"),
      () => textTurn("never"),
    ]);
    const out = JSON.parse(await browseAgent({ goal: "g", qa: true }, { sessionId: "chat-1", toolCallId: "tc-q", signal: ac.signal }));
    expect(out.status).toBe("aborted");
  });

  it("the registry qa_assert (main chat path) refuses", async () => {
    const out = JSON.parse(await toolHandlers.qa_assert({ checks: [] }));
    expect(out.error).toContain("only available inside a browse_agent QA run");
  });

  it("qa on, no verdict: outcome is inconclusive", async () => {
    stubFetch([() => textTurn("blocked by a captcha")]);
    const out = JSON.parse(await run(true));
    expect(out.status).toBe("done");
    expect(out.qa).toMatchObject({ outcome: "inconclusive", steps: [] });
  });

  it("qa with resume: error result, no request", async () => {
    const captured = stubFetch([]);
    const out = JSON.parse(await browseAgent({ goal: "g", qa: true, resume: "cp_1" }, { sessionId: "chat-1" }));
    expect(out.status).toBe("error");
    expect(out.error).toContain("resume");
    expect(captured).toHaveLength(0);
  });

  it("the registry qa_verdict (main chat path) refuses", async () => {
    const out = JSON.parse(await toolHandlers.qa_verdict({ verdict: "pass", reason: "x" }));
    expect(out.error).toContain("only available inside a browse_agent QA run");
  });

  it("qa off: no browseQa, no qa field, output unchanged", async () => {
    const captured = stubFetch([() => textTurn("done")]);
    const out = JSON.parse(await run());
    expect(captured[0].body).not.toHaveProperty("browseQa");
    expect(out).toEqual({ status: "done", answer: "done", steps: 0 });
  });

  it("qa off: qa_verdict is refused by the allowlist", async () => {
    const captured = stubFetch([
      () => toolTurn("qa_verdict", { verdict: "pass", reason: "x" }, "c1"),
      () => textTurn("ok"),
    ]);
    const out = JSON.parse(await run(false));
    expect(JSON.parse(outputOf(captured, 1, "c1")).error).toBeDefined();
    expect(out).not.toHaveProperty("qa");
  });
});

describe("nestedChatId", () => {
  it("keeps only safe characters and caps the length", () => {
    const id = nestedChatId("a b/c", `x${"y".repeat(400)}`);
    expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(id.length).toBeLessThanOrEqual(200);
  });
});
