import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolHandlers, type ToolHandler } from "@/lib/toolRegistry";
import { sse } from "@/test/sseStream";
import { BROWSE_AGENT_OUTER_TIMEOUT_MS } from "@sideform/browser-agent/agent/session";
import { cleanupBrowseAgentTest, fixtureBridgeMocks, stubBrowseOpenSnapshot } from "./helpers";
import { browseAgent, judgeRequestJson, limitChecks, resetJudgeAvailability } from "../browseAgent";

const loopState = vi.hoisted(() => ({ throwOnReset: false }));
vi.mock("@sideform/browser-agent/loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sideform/browser-agent/loop")>();
  return {
    ...actual,
    resetLoopGuard: (...a: Parameters<typeof actual.resetLoopGuard>) => {
      if (loopState.throwOnReset) throw new Error("reset boom");
      return actual.resetLoopGuard(...a);
    },
  };
});

// The QA judge (browser-agent spec 2026-10-19-qa-judge-design.md) in the browse_agent handler.

const verdictTurn = (verdict: string): Response =>
  sse([
    { type: "start" },
    { type: "start-step" },
    { type: "tool-input-available", toolCallId: "c1", toolName: "qa_verdict", input: { verdict, reason: "cart shows 3 items" } },
    { type: "finish-step" },
    { type: "finish" },
  ]);

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const PAGE = { url: "https://shop.test/cart", title: "Cart", text: "3 items in your cart" };
const ctx = { sessionId: "chat-1", toolCallId: "tc-j" };
const SETUP = { steps: [{ action: "click", selector: "#go" }] };

let judgeBodies: Array<Record<string, unknown>>;
let judgeAnswer: (init: RequestInit) => Response | Promise<Response>;
let restoreHandlers: () => void;
let bridge: ReturnType<typeof bridgeOf>;
let nestedRead: ReturnType<typeof vi.fn<ToolHandler>>;
let savedRead: ToolHandler | undefined;

const bridgeOf = () => ({
  read: vi.fn(async (): Promise<unknown> => PAGE),
  snapshot: vi.fn(async (): Promise<unknown> => ({})),
  clearActEmulation: vi.fn(async () => ({ ok: true })),
  ...fixtureBridgeMocks(),
});

function install(extra: Record<string, unknown> = {}) {
  window.penDesktop = { onMenuCommand: () => () => {}, browser: { ...bridge, ...extra } } as never;
}

function stubFetch(verdict: string, preTurns: Response[] = []) {
  let chatCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/browser/")) return json({ result: { error: "no cloud browser in this test" } });
      if (url.includes("/api/browse/judge")) {
        judgeBodies.push(JSON.parse(String(init?.body)));
        return judgeAnswer(init ?? {});
      }
      return preTurns[chatCalls++] ?? verdictTurn(verdict);
    }),
  );
}

const run = async (extra: Record<string, unknown> = {}, context: Parameters<typeof browseAgent>[1] = ctx) =>
  JSON.parse(await browseAgent({ goal: "Check the cart", qa: true, ...extra }, context));

/** One run whose judge answers: the app now knows the judge route exists ("on"). */
async function primeJudgeOn() {
  stubFetch("pass");
  await run();
  judgeBodies = [];
  bridge.read.mockClear();
}

/** A judge response that stays pending until `answer` is called. */
function deferredJudge() {
  const d: { answer: (r: Response) => void } = { answer: () => {} };
  judgeAnswer = () => new Promise<Response>((resolve) => (d.answer = resolve));
  return d;
}

beforeEach(() => {
  resetJudgeAvailability();
  loopState.throwOnReset = false;
  judgeBodies = [];
  judgeAnswer = () => json({ verdict: "pass", reason: "ok" });
  bridge = bridgeOf();
  restoreHandlers = stubBrowseOpenSnapshot();
  // The judge reads through the bridge, never through the nested-tool path.
  savedRead = toolHandlers.browse_read;
  nestedRead = vi.fn<ToolHandler>(async () => JSON.stringify(PAGE));
  toolHandlers.browse_read = nestedRead;
  install();
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanupBrowseAgentTest(restoreHandlers);
  if (savedRead) toolHandlers.browse_read = savedRead;
  else delete toolHandlers.browse_read;
});

describe("browse_agent QA judge", () => {
  it("asks the judge for a passed run, reading the page through the bridge; a pass is recorded", async () => {
    stubFetch("pass");
    const out = await run();
    expect(judgeBodies).toHaveLength(1);
    expect(bridge.read).toHaveBeenCalledWith({ maxChars: 20_000 });
    expect(nestedRead).not.toHaveBeenCalled();
    expect(out.qa).toMatchObject({ outcome: "passed", judge: { verdict: "pass", reason: "ok" } });
  });

  it("sends the scenario, the evidence and the page, never a verdict, a reason or a qa_verdict step", async () => {
    stubFetch("pass");
    await run();
    const [body] = judgeBodies;
    expect(body.scenario).toBe("Check the cart");
    expect(body.page).toEqual(PAGE);
    const qa = body.qa as { steps: Array<{ tool: string }> };
    expect(qa.steps.map((s) => s.tool)).not.toContain("qa_verdict");
    for (const key of ["verdict", "reason", "outcome", "judge"]) expect(qa).not.toHaveProperty(key);
    const raw = JSON.stringify(body);
    for (const word of ["qa_verdict", '"verdict"', '"reason"', '"outcome"', "cart shows 3 items"]) expect(raw).not.toContain(word);
  });

  it("cuts the page text, title and url before the request", async () => {
    bridge.read.mockResolvedValue({ url: `https://a.test/${"u".repeat(5000)}`, title: "t".repeat(2000), text: "x".repeat(25_000) });
    stubFetch("pass");
    await run();
    const page = judgeBodies[0].page as { url: string; title: string; text: string; truncated?: boolean };
    expect([page.url.length, page.title.length, page.text.length, page.truncated]).toEqual([4096, 1024, 20_000, true]);
  });

  it("a judge fail lowers the outcome to failed with the combined reason", async () => {
    judgeAnswer = () => json({ verdict: "fail", reason: "the cart shows 2 items" });
    stubFetch("pass");
    const out = await run();
    expect(out.qa.outcome).toBe("failed");
    expect(out.qa.reason).toBe("Judge: the cart shows 2 items. Agent verdict: cart shows 3 items");
    expect(out.qa.judge).toEqual({ verdict: "fail", reason: "the cart shows 2 items" });
  });

  it.each([
    ["an { error } answer", () => json({ error: "model down" }), "model down"],
    ["an HTTP error with an error text", () => json({ error: "judge overloaded" }, 503), "judge overloaded"],
    ["an HTTP error without a body", () => new Response("", { status: 500 }), "judge responded 500"],
    ["a network failure", () => Promise.reject(new Error("offline")), "offline"],
  ])("%s keeps the outcome passed and sets judge.error", async (_name, answer, text) => {
    judgeAnswer = answer;
    stubFetch("pass");
    const out = await run();
    expect(out.qa.outcome).toBe("passed");
    expect(out.qa.judge.error).toContain(text);
  });

  it.each([
    ["{ disabled: true }", () => json({ disabled: true })],
    ["HTTP 404", () => new Response("Not found", { status: 404 })],
    ["HTTP 405", () => new Response("", { status: 405 })],
    ["HTTP 501", () => new Response("", { status: 501 })],
    ["a 200 that is not JSON", () => new Response("<html>spa shell</html>", { status: 200 })],
    ["a 200 JSON that is not a judge answer", () => json({ ok: true })],
  ])("%s: no judge field, and the next run skips the reads and the request", async (_name, answer) => {
    judgeAnswer = answer;
    stubFetch("pass");
    const out = await run();
    expect(out.qa.outcome).toBe("passed");
    expect(out.qa).not.toHaveProperty("judge");
    expect(judgeBodies).toHaveLength(1);
    bridge.read.mockClear();
    const next = await run();
    expect(next.qa).not.toHaveProperty("judge");
    expect(judgeBodies).toHaveLength(1);
    expect(bridge.read).not.toHaveBeenCalled();
  });

  it("falls back to browse_snapshot when the read has no text", async () => {
    bridge.read.mockResolvedValue({ error: "boom" });
    bridge.snapshot.mockResolvedValue({ url: "https://shop.test/x", title: "T", text: "snap text" });
    stubFetch("pass");
    await run();
    expect(judgeBodies[0].page).toEqual({ url: "https://shop.test/x", title: "T", text: "snap text" });
  });

  it("a page that cannot be read: judge.error once the judge is known, otherwise qa is unchanged", async () => {
    bridge.read.mockResolvedValue({ error: "boom" });
    bridge.snapshot.mockResolvedValue({ error: "no page" });
    stubFetch("pass");
    const unknown = await run();
    expect(unknown.qa).toMatchObject({ outcome: "passed" });
    expect(unknown.qa).not.toHaveProperty("judge");
    expect(judgeBodies).toHaveLength(0);
    bridge.read.mockResolvedValue(PAGE);
    await primeJudgeOn();
    bridge.read.mockResolvedValue({ error: "boom" });
    const known = await run();
    expect(judgeBodies).toHaveLength(0);
    expect(known.qa).toMatchObject({ outcome: "passed", judge: { error: expect.stringContaining("page read failed") } });
  });

  it("does not ask the judge for a failed run or a non-QA run", async () => {
    stubFetch("fail");
    expect((await run()).qa.outcome).toBe("failed");
    stubFetch("pass");
    expect(await run({ qa: undefined })).not.toHaveProperty("qa");
    expect(judgeBodies).toHaveLength(0);
    expect(bridge.read).not.toHaveBeenCalled();
  });

  it("reads the page before the fixture release; the release and the viewport reset do not wait for the judge", async () => {
    const judge = deferredJudge();
    stubFetch("pass");
    let settled = false;
    const pending = run({ url: "https://shop.test/cart", setup: SETUP }).finally(() => (settled = true));
    await vi.waitFor(() => expect(bridge.clearActEmulation).toHaveBeenCalled());
    expect(judgeBodies).toHaveLength(1);
    expect(bridge.releaseFixture).toHaveBeenCalledWith("tok-1");
    expect(bridge.read.mock.invocationCallOrder[0]).toBeLessThan(bridge.releaseFixture.mock.invocationCallOrder[0]);
    expect(bridge.releaseFixture.mock.invocationCallOrder[0]).toBeLessThan(bridge.clearActEmulation.mock.invocationCallOrder[0]);
    expect(settled).toBe(false);
    judge.answer(json({ verdict: "fail", reason: "wrong total" }));
    expect((await pending).qa.outcome).toBe("failed");
  });

  it("reports the mock rules that answered no request as qa.unmatchedMocks, read after the release", async () => {
    stubFetch("pass");
    bridge.releaseFixture.mockResolvedValue({
      ok: true,
      mockHits: [
        { method: "GET", url: "**/api/contacts", hits: 2 },
        { method: "POST", url: "**/api/contacts/export", hits: 0 },
        { url: "**/api/legacy", hits: 0 },
      ],
    } as never);
    const result = await run({ url: "https://shop.test/cart", setup: SETUP });
    expect(result.qa.unmatchedMocks).toEqual([{ method: "POST", url: "**/api/contacts/export" }, { url: "**/api/legacy" }]);
  });

  it("leaves qa.unmatchedMocks out when every rule answered or the bridge reports no hits", async () => {
    stubFetch("pass");
    bridge.releaseFixture.mockResolvedValue({ ok: true, mockHits: [{ url: "**/api/x", hits: 1 }] } as never);
    expect((await run({ url: "https://shop.test/cart", setup: SETUP })).qa).not.toHaveProperty("unmatchedMocks");
    bridge.releaseFixture.mockResolvedValue({ ok: true } as never);
    expect((await run({ url: "https://shop.test/cart", setup: SETUP })).qa).not.toHaveProperty("unmatchedMocks");
  });

  it("an abort during the judge request keeps passed and records judge.error", async () => {
    const ac = new AbortController();
    judgeAnswer = (init) =>
      new Promise<Response>((_, reject) => {
        ac.abort();
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        if (init.signal?.aborted) reject(new Error("aborted"));
      });
    stubFetch("pass");
    const out = await run({}, { ...ctx, signal: ac.signal });
    expect(out.qa).toMatchObject({ outcome: "passed", judge: { error: expect.any(String) } });
  });

  it("an aborted signal at judge time is judge.error aborted (once the judge is known): no read, no request, outcome kept", async () => {
    const ac = new AbortController();
    await primeJudgeOn();
    // The final check aborts the run's signal after the verdict: the outcome stays passed, the judge sees the abort.
    const assert = vi.fn(async () => {
      ac.abort();
      return { ok: true, passed: true, results: [{ check: { type: "text", text: "Hello" }, passed: true }] };
    });
    install({ assert });
    const out = await run({ checks: [{ type: "text", text: "Hello" }] }, { ...ctx, signal: ac.signal });
    expect(judgeBodies).toHaveLength(0);
    expect(bridge.read).not.toHaveBeenCalled();
    expect(out.qa).toMatchObject({ outcome: "passed", judge: { error: "aborted" } });
  });

  it("with no time left before the outer timeout the judge is skipped; the error shows only once the judge is known", async () => {
    const realNow = Date.now.bind(Date);
    let offset = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    toolHandlers.browse_open = vi.fn(async () => {
      offset = BROWSE_AGENT_OUTER_TIMEOUT_MS - 10_000;
      return "{}";
    });
    stubFetch("pass");
    const unknown = await run({ url: "https://shop.test/cart" });
    expect(unknown.qa).not.toHaveProperty("judge");
    offset = 0;
    await primeJudgeOn();
    offset = 0;
    const known = await run({ url: "https://shop.test/cart" });
    expect(judgeBodies).toHaveLength(0);
    expect(known.qa).toMatchObject({ outcome: "passed", judge: { error: "no time left for the judge" } });
  });

  it("the outer limit is the call's own timeoutMs, and the reads plus the cleanup tail must fit before the margin", async () => {
    await primeJudgeOn();
    const tooShort = await run({}, { ...ctx, timeoutMs: 50_000 });
    expect(bridge.read).not.toHaveBeenCalled();
    expect(tooShort.qa.judge).toEqual({ error: "no time left for the judge" });
    const enough = await run({}, { ...ctx, timeoutMs: 5 * 60_000 });
    expect(enough.qa.judge).toMatchObject({ verdict: "pass" });
  });

  it("an abort while the read is hanging ends the read at once: judge.error aborted", async () => {
    await primeJudgeOn();
    const ac = new AbortController();
    bridge.read.mockImplementation(() => {
      ac.abort();
      return new Promise<unknown>(() => {});
    });
    const out = await run({}, { ...ctx, signal: ac.signal });
    expect(judgeBodies).toHaveLength(0);
    expect(out.qa).toMatchObject({ outcome: "passed", judge: { error: "aborted" } });
  });

  it("cuts the request body to the endpoint's limits", async () => {
    const bigArgs = { url: `https://a.test/${'q"'.repeat(3000)}` };
    stubFetch("pass", [
      sse([
        { type: "start" },
        { type: "start-step" },
        { type: "tool-input-available", toolCallId: "c0", toolName: "browse_open", input: bigArgs },
        { type: "finish-step" },
        { type: "finish" },
      ]),
    ]);
    const assert = vi.fn(async () => ({
      ok: true,
      passed: true,
      results: [{ check: { type: "text", text: "T".repeat(900) }, passed: true, actual: "A".repeat(5000) }],
    }));
    install({ assert });
    await run({ goal: "G".repeat(10_000), checks: [{ type: "text", text: "T".repeat(900) }] });
    const body = judgeBodies[0] as { scenario: string; qa: { steps: Array<{ args?: unknown }>; checks: unknown[] } };
    expect(body.scenario.length).toBeLessThanOrEqual(8000);
    expect(body.qa.steps.length).toBeGreaterThan(0);
    for (const step of body.qa.steps) expect(JSON.stringify(step.args).length).toBeLessThanOrEqual(2000);
    expect(typeof body.qa.steps[0].args).toBe("string");
    expect(body.qa.checks.length).toBeGreaterThan(0);
    for (const check of body.qa.checks) expect(JSON.stringify(check).length).toBeLessThanOrEqual(2000);
  });
});

describe("browse_agent QA judge, isolated run", () => {
  it("reads through the run's own session browser, before the viewport reset and the session close", async () => {
    const shared = bridgeOf();
    const iso = bridgeOf();
    const isolated = vi.fn(() => iso);
    const closeSession = vi.fn(async () => ({ ok: true }));
    window.penDesktop = { onMenuCommand: () => () => {}, browser: { ...shared, isolated, closeSession } } as never;
    const judge = deferredJudge();
    stubFetch("pass");
    let settled = false;
    const pending = run({ url: "https://shop.test/cart" }).finally(() => (settled = true));
    await vi.waitFor(() => expect(closeSession).toHaveBeenCalled());
    expect(isolated).toHaveBeenCalled();
    expect(iso.read).toHaveBeenCalledWith({ maxChars: 20_000 });
    expect(shared.read).not.toHaveBeenCalled();
    expect(iso.read.mock.invocationCallOrder[0]).toBeLessThan(iso.clearActEmulation.mock.invocationCallOrder[0]);
    expect(iso.read.mock.invocationCallOrder[0]).toBeLessThan(closeSession.mock.invocationCallOrder[0]);
    expect(settled).toBe(false);
    judge.answer(json({ verdict: "pass", reason: "ok" }));
    expect((await pending).qa.judge).toMatchObject({ verdict: "pass" });
  });

  it("aborts the started judge request when the outer cleanup throws", async () => {
    const iso = bridgeOf();
    window.penDesktop = { onMenuCommand: () => () => {}, browser: { ...bridgeOf(), isolated: vi.fn(() => iso), closeSession: vi.fn(async () => ({ ok: true })) } } as never;
    let requestSignal: AbortSignal | undefined;
    judgeAnswer = (init) => {
      requestSignal = init.signal ?? undefined;
      // The cleanup's loop-guard reset (after the judge started) throws.
      loopState.throwOnReset = true;
      return new Promise<Response>(() => {});
    };
    stubFetch("pass");
    await expect(run({ url: "https://shop.test/cart" })).rejects.toThrow("reset boom");
    expect(requestSignal?.aborted).toBe(true);
  });
});

describe("browse_agent QA judge, transport and limits", () => {
  it("a runtime without AbortSignal.timeout still resolves to a judge error, never a rejection", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      throw new Error("no timeout signal here");
    });
    stubFetch("pass");
    const out = await run();
    expect(out.qa).toMatchObject({ outcome: "passed", judge: { error: expect.stringContaining("no timeout signal") } });
  });

  it("a runtime without AbortSignal.any falls back to a combined signal and still gets the verdict", async () => {
    const original = AbortSignal.any;
    Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true, writable: true });
    try {
      stubFetch("pass");
      const out = await run();
      expect(out.qa.judge).toMatchObject({ verdict: "pass" });
    } finally {
      Object.defineProperty(AbortSignal, "any", { value: original, configurable: true, writable: true });
    }
  });

  it("a 413 is a judge error and does not mark the judge as available", async () => {
    judgeAnswer = () => json({ error: "Payload Too Large" }, 413);
    stubFetch("pass");
    const first = await run();
    expect(first.qa.judge.error).toContain("too large");
    // The state is still unknown: a failure before the request leaves qa unchanged.
    bridge.read.mockResolvedValue({ error: "boom" });
    const second = await run();
    expect(second.qa).not.toHaveProperty("judge");
  });

  it("forgets a missing route after 10 minutes", async () => {
    const realNow = Date.now.bind(Date);
    let offset = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    judgeAnswer = () => new Response("", { status: 404 });
    stubFetch("pass");
    await run();
    await run();
    expect(judgeBodies).toHaveLength(1);
    offset = 11 * 60_000;
    await run();
    expect(judgeBodies).toHaveLength(2);
  });

  const check = (i: number, passed: boolean, text = "t") =>
    ({ source: "agent", check: { type: "text", text: `${text}${i}` }, passed }) as never;

  it("over the check cap keeps every failed check, then the latest passed ones, in the original order", () => {
    const checks = Array.from({ length: 450 }, (_, i) => check(i, ![3, 100, 200].includes(i)));
    const kept = limitChecks(checks, 400) as unknown as Array<{ check: { text: string }; passed: boolean }>;
    expect(kept).toHaveLength(400);
    const texts = kept.map((c) => c.check.text);
    for (const failed of ["t3", "t100", "t200"]) expect(texts).toContain(failed);
    expect(texts).not.toContain("t0");
    expect(texts).toContain("t449");
    const indexes = texts.map((t) => Number(t.slice(1)));
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  const qaOf = (extra: Record<string, unknown>) => ({ outcome: "passed", steps: [], ...extra }) as never;
  const bytesOf = (text: string) => new TextEncoder().encode(text).length;

  it("keeps the whole body under the route's byte limit: passed checks first, then step args", () => {
    const checks = [check(0, false), ...Array.from({ length: 399 }, (_, i) => check(i + 1, true, "é".repeat(900)))];
    const page = { url: "https://a.test", title: "T", text: "é".repeat(20_000) };
    const json = judgeRequestJson("scenario", qaOf({ checks }), page);
    expect(bytesOf(json)).toBeLessThanOrEqual(150_000);
    const body = JSON.parse(json) as { qa: { checks: Array<{ passed: boolean }> }; page: { text: string } };
    expect(body.qa.checks.some((c) => !c.passed)).toBe(true);
    expect(body.page.text).toHaveLength(20_000);

    const steps = Array.from({ length: 30 }, (_, i) => ({ index: i + 1, tool: "browse_act", args: { v: "𝄞".repeat(900) }, ok: true }));
    const big = judgeRequestJson("𝄞".repeat(8000), qaOf({ steps }), { ...page, text: "𝄞".repeat(20_000) });
    expect(bytesOf(big)).toBeLessThanOrEqual(150_000);
    const parsed = JSON.parse(big) as { qa: { steps: Array<{ args: unknown }> } };
    expect(parsed.qa.steps[0].args).toBe("…");
  });

  it("caps only the `check` field at 2000 chars of JSON; actual and error are cut to 500", () => {
    const record = {
      source: "agent",
      check: { type: "text", text: "x".repeat(1000), also: "y".repeat(1500) },
      passed: false,
      actual: "a".repeat(900),
      error: "e".repeat(900),
    };
    const body = JSON.parse(judgeRequestJson("s", qaOf({ checks: [record, { ...record, check: { type: "text", text: "ok" } }] }), PAGE)) as {
      qa: { checks: Array<{ check: unknown; actual: string; error: string }> };
    };
    expect(body.qa.checks[0].check).toEqual({ type: "text", cut: true });
    expect(body.qa.checks[1].check).toEqual({ type: "text", text: "ok" });
    expect([body.qa.checks[0].actual.length, body.qa.checks[0].error.length]).toEqual([500, 500]);
  });

  it("sends pageAtCheck cut to 4096/1024 and keeps check target cut to 80; bodies without them are unchanged", () => {
    const record = { source: "agent", check: { type: "text", text: "ok" }, passed: true };
    const withBoth = JSON.parse(
      judgeRequestJson(
        "s",
        qaOf({
          checks: [{ ...record, target: "t".repeat(300) }, { ...record, target: 'button "Buy"' }],
          pageAtCheck: { url: "u".repeat(5000), title: "T".repeat(2000) },
        }),
        PAGE,
      ),
    ) as { qa: { checks: Array<{ target?: string }>; pageAtCheck: { url: string; title: string } } };
    expect(withBoth.qa.pageAtCheck.url).toHaveLength(4096);
    expect(withBoth.qa.pageAtCheck.title).toHaveLength(1024);
    expect(withBoth.qa.checks[0].target).toHaveLength(80);
    expect(withBoth.qa.checks[1].target).toBe('button "Buy"');

    const plain = JSON.parse(judgeRequestJson("s", qaOf({ checks: [record] }), PAGE)) as { qa: Record<string, unknown> };
    expect("pageAtCheck" in plain.qa).toBe(false);
    expect("target" in (plain.qa.checks as object[])[0]).toBe(false);
  });
});
