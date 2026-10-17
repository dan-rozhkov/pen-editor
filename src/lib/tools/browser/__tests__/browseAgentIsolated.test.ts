import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupBrowseAgentTest, fixtureBridgeMocks, textTurn } from "./helpers";

const loop = vi.hoisted(() => ({ reset: vi.fn(), apply: vi.fn() }));
const createSessionSpy = vi.hoisted(() => vi.fn());
vi.mock("@sideform/browser-agent/agent/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sideform/browser-agent/agent/session")>();
  return {
    ...actual,
    createBrowseAgentSession: (...a: Parameters<typeof actual.createBrowseAgentSession>) => {
      createSessionSpy(...a);
      return actual.createBrowseAgentSession(...a);
    },
  };
});
vi.mock("@sideform/browser-agent/loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sideform/browser-agent/loop")>();
  return {
    ...actual,
    resetLoopGuard: (...a: unknown[]) => {
      loop.reset(...a);
      return (actual.resetLoopGuard as (...x: unknown[]) => unknown)(...a);
    },
    applyLoopGuard: (...a: unknown[]) => {
      loop.apply(...a);
      return (actual.applyLoopGuard as (...x: unknown[]) => unknown)(...a);
    },
  };
});

import { browseAgent } from "../browseAgent";
import { BROWSE_AGENT_DEADLINE_MS } from "@sideform/browser-agent/agent/session";
import { CLOSE_SESSION_TIMEOUT_MS, getBrowserBridge, closeBrowserSession } from "../bridge";
import { useBrowseCheckpointStore } from "@/store/browseCheckpointStore";
import { runSessionId } from "../isolation";
import { MAX_PARALLEL_BROWSE_RUNS, browseRunCounts } from "@/lib/browseRunLimiter";

const ctx = { sessionId: "chat-1", toolCallId: "tc-1" };
const runId = () => isolated.mock.calls[0][0] as string;

const bridgeOf = () => ({
  open: vi.fn(async () => ({})),
  act: vi.fn(async () => ({})),
  findImages: vi.fn(async () => ({})),
  read: vi.fn(async () => ({})),
  snapshot: vi.fn(async () => ({})),
  perform: vi.fn(async () => ({})),
  ...fixtureBridgeMocks(),
});

let shared: ReturnType<typeof bridgeOf>;
let iso: ReturnType<typeof bridgeOf>;
let isolated: ReturnType<typeof vi.fn>;
let closeSession: ReturnType<typeof vi.fn>;

function install(withIsolated = true) {
  window.penDesktop = {
    onMenuCommand: () => () => {},
    browser: { ...shared, ...(withIsolated ? { isolated, closeSession } : {}) },
  } as never;
}

beforeEach(() => {
  shared = bridgeOf();
  iso = bridgeOf();
  isolated = vi.fn(() => iso);
  closeSession = vi.fn(async () => ({ ok: true }));
  createSessionSpy.mockClear();
  loop.reset.mockClear();
  loop.apply.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => textTurn("All good")));
  install();
});

afterEach(() => cleanupBrowseAgentTest(() => {}));

const SETUP = { steps: [{ action: "click", selector: "#go" }] };

describe("browse_agent isolated QA run", () => {
  it("drives the pre-open and snapshot through the isolated bridge and closes the session", async () => {
    await browseAgent({ goal: "g", url: "https://a.test", qa: true }, ctx);
    expect(isolated).toHaveBeenCalledWith(runId());
    expect(iso.open).toHaveBeenCalled();
    expect(shared.open).not.toHaveBeenCalled();
    expect(shared.snapshot).not.toHaveBeenCalled();
    expect(closeSession).toHaveBeenCalledWith(runId());
  });

  it("applies and releases the fixture on the isolated bridge, then closes the session", async () => {
    const raw = await browseAgent({ goal: "g", url: "https://a.test", qa: true, setup: SETUP }, ctx);
    expect(JSON.parse(raw)).toMatchObject({ setupApplied: true });
    expect(iso.applyFixture).toHaveBeenCalledTimes(1);
    expect(iso.releaseFixture).toHaveBeenCalledWith("tok-1");
    expect(shared.applyFixture).not.toHaveBeenCalled();
    expect(iso.releaseFixture.mock.invocationCallOrder[0]).toBeLessThan(closeSession.mock.invocationCallOrder[0]);
  });

  it("closes the session when the run fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await browseAgent({ goal: "g", url: "https://a.test", qa: true }, ctx);
    expect(closeSession).toHaveBeenCalledWith(runId());
  });

  it("closes the session when the run is aborted mid-run", async () => {
    let release: () => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { release = () => r(textTurn("late")); })));
    const ac = new AbortController();
    const run = browseAgent({ goal: "g", url: "https://a.test", qa: true }, { ...ctx, signal: ac.signal });
    await vi.waitFor(() => expect(iso.open).toHaveBeenCalled());
    ac.abort();
    release();
    expect(JSON.parse(await run).status).toBe("aborted");
    expect(closeSession).toHaveBeenCalledWith(runId());
  });

  it("an already-aborted call opens no browser at all", async () => {
    const ac = new AbortController();
    ac.abort();
    const out = JSON.parse(await browseAgent({ goal: "g", url: "https://a.test", qa: true }, { ...ctx, signal: ac.signal }));
    expect(out.status).toBe("aborted");
    expect(isolated).not.toHaveBeenCalled();
  });

  it("keys the loop guard by the run session, not the chat", async () => {
    await browseAgent({ goal: "g", url: "https://a.test", qa: true }, ctx);
    expect(loop.reset).toHaveBeenCalledWith(runId());
    expect(loop.apply).toHaveBeenCalled();
    expect(loop.apply.mock.calls.every((c) => c[3] === runId())).toBe(true);
  });

  it("two parallel runs use separate sessions", async () => {
    await Promise.all([
      browseAgent({ goal: "g", url: "https://a.test", qa: true }, { sessionId: "chat-1", toolCallId: "x1" }),
      browseAgent({ goal: "g", url: "https://a.test", qa: true }, { sessionId: "chat-1", toolCallId: "x2" }),
    ]);
    const ids = isolated.mock.calls.map((c) => c[0] as string);
    expect(new Set(ids).size).toBe(2);
    expect(ids.some((i) => i.includes("-x1-"))).toBe(true);
    expect(ids.some((i) => i.includes("-x2-"))).toBe(true);
    // A nonce: the same chat and tool call id never give the same session twice.
    expect(runSessionId("chat-1", "x1")).not.toBe(runSessionId("chat-1", "x1"));
    expect(runSessionId("chat-1", "x1")).not.toBe(runSessionId("chat-2", "x1"));
    expect(runSessionId("chat-1", undefined)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(closeSession).toHaveBeenCalledTimes(2);
  });

  it("sanitizes the session id from the tool call id and caps it at 64 chars", async () => {
    await browseAgent({ goal: "g", url: "https://a.test", qa: true }, { sessionId: "chat-1", toolCallId: `call:${"x".repeat(100)}` });
    const id = isolated.mock.calls[0][0] as string;
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(id).toHaveLength(64);
    // Two long ids with a common 60-char prefix still differ.
    const a = runSessionId("chat-1", `${"y".repeat(80)}1`);
    const b = runSessionId("chat-1", `${"y".repeat(80)}2`);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a.slice(0, -7)).not.toBe(b.slice(0, -7));
  });

  it("drops the run's loop-guard ring when the run ends", async () => {
    await browseAgent({ goal: "g", url: "https://a.test", qa: true }, ctx);
    expect(loop.reset.mock.calls.filter((c) => c[0] === runId()).length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to the shared bridge when the shell has no browser.isolated", async () => {
    install(false);
    await browseAgent({ goal: "g", url: "https://a.test", qa: true }, ctx);
    expect(shared.open).toHaveBeenCalled();
    expect(isolated).not.toHaveBeenCalled();
    expect(closeSession).not.toHaveBeenCalled();
    expect(loop.reset).toHaveBeenCalledWith("chat-1");
  });

  it("a non-QA run keeps the shared bridge even when isolation exists", async () => {
    await browseAgent({ goal: "g", url: "https://a.test" }, ctx);
    expect(shared.open).toHaveBeenCalled();
    expect(isolated).not.toHaveBeenCalled();
    expect(closeSession).not.toHaveBeenCalled();
  });

  it.each([
    ["an isolated QA run", true, undefined],
    ["a shared QA run", false, true],
  ])("%s: browseLogin in the nested body is %s", async (_l, withIsolated, expected) => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_i: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return textTurn("ok");
    }));
    const fillLogin = vi.fn(async () => ({}));
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: { ...shared, fillLogin, ...(withIsolated ? { isolated: () => ({ ...iso, fillLogin }), closeSession } : {}) },
    } as never;
    await browseAgent({ goal: "g", url: "https://a.test", qa: true }, ctx);
    expect(bodies[0].browseLogin).toBe(expected);
    expect(bodies[0].browseQa).toBe(true);
  });

  it("never records a checkpoint: no journal, no store entry, no checkpoint field", async () => {
    const startJournal = vi.fn(async () => "tok");
    Object.assign(iso, { startJournal, stopJournal: vi.fn(async () => ({})), captureCheckpoint: vi.fn(async () => ({ ok: true })) });
    const raw = await browseAgent({ goal: "g", url: "https://a.test", qa: true, setup: SETUP }, ctx);
    expect(JSON.parse(raw).checkpoint).toBeUndefined();
    expect(startJournal).not.toHaveBeenCalled();
    expect(useBrowseCheckpointStore.getState().get("chat-1", "cp_1")).toBeUndefined();
  });

  it("closes the session even when the setup is malformed", async () => {
    const raw = await browseAgent({ goal: "g", url: "https://a.test", qa: true, setup: { steps: [{ action: "nope" }] } }, ctx);
    expect(JSON.parse(raw)).toMatchObject({ status: "setup_failed", setupStage: "validate" });
    expect(closeSession).toHaveBeenCalledTimes(1);
  });

  it("a closed run session never revives: its bridge answers an error and isolated() is not called again", async () => {
    await closeBrowserSession("qa-dead-session");
    const calls = isolated.mock.calls.length;
    const bridge = getBrowserBridge("chat-1", "qa-dead-session");
    expect(await bridge?.snapshot()).toEqual({ error: "browser session closed" });
    expect(await bridge?.applyFixture?.({} as never)).toEqual({ error: "browser session closed" });
    expect(isolated.mock.calls.length).toBe(calls);
  });

  describe("concurrency cap", () => {
    let gate: () => void;
    beforeEach(() => {
      const open = new Promise<void>((r) => (gate = r));
      vi.stubGlobal("fetch", vi.fn(async () => {
        await open;
        return textTurn("done");
      }));
    });

    const start = (id: string, signal?: AbortSignal) =>
      browseAgent({ goal: "g", url: "https://a.test", qa: true }, { sessionId: "chat-1", toolCallId: id, signal });

    it("opens at most 4 isolated sessions at once; the rest wait and start as slots free", async () => {
      const runs = ["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => start(id));
      await vi.waitFor(() => expect(isolated.mock.calls.length).toBeGreaterThanOrEqual(MAX_PARALLEL_BROWSE_RUNS));
      await new Promise((r) => setTimeout(r, 30));
      expect(new Set(isolated.mock.calls.map((c) => c[0])).size).toBe(MAX_PARALLEL_BROWSE_RUNS);
      expect(browseRunCounts()).toEqual({ active: 4, waiting: 2 });
      gate();
      await Promise.all(runs);
      expect(new Set(isolated.mock.calls.map((c) => c[0])).size).toBe(6);
      expect(closeSession).toHaveBeenCalledTimes(6);
      expect(browseRunCounts()).toEqual({ active: 0, waiting: 0 });
    });

    it("an abort while waiting answers aborted and never opens a browser", async () => {
      const first = ["d1", "d2", "d3", "d4"].map((id) => start(id));
      await vi.waitFor(() => expect(browseRunCounts().active).toBe(4));
      const ac = new AbortController();
      const waiting = start("d5", ac.signal);
      await vi.waitFor(() => expect(browseRunCounts().waiting).toBe(1));
      ac.abort();
      expect(JSON.parse(await waiting)).toMatchObject({ status: "aborted", steps: 0 });
      expect(isolated.mock.calls.some((c) => String(c[0]).includes("-d5-"))).toBe(false);
      expect(browseRunCounts().waiting).toBe(0);
      gate();
      await Promise.all(first);
    });

    it("gives the slot back after closeSession", async () => {
      gate();
      await start("e1");
      expect(browseRunCounts().active).toBe(0);
    });

    it("a run that waited for a slot gets a shorter own deadline", async () => {
      vi.useFakeTimers();
      try {
        const first = ["w1", "w2", "w3", "w4"].map((id) => start(id));
        await vi.advanceTimersByTimeAsync(10);
        const late = start("w5");
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        gate();
        await Promise.all([...first, late]);
        const deadlines = createSessionSpy.mock.calls.map((c) => (c[0] as { deadlineMs?: number }).deadlineMs);
        const full = BROWSE_AGENT_DEADLINE_MS - CLOSE_SESSION_TIMEOUT_MS;
        expect(deadlines.filter((d) => d !== undefined && d > full - 1000).length).toBe(4);
        const shrunk = deadlines.find((d) => d !== undefined && d <= full - 1000);
        expect(shrunk).toBeLessThanOrEqual(full - 5 * 60_000);
      } finally {
        vi.useRealTimers();
      }
    });

    it("waiting almost the whole deadline: a clear error and no browser", async () => {
      vi.useFakeTimers();
      try {
        const first = ["z1", "z2", "z3", "z4"].map((id) => start(id));
        await vi.advanceTimersByTimeAsync(10);
        const late = start("z5");
        await vi.advanceTimersByTimeAsync(BROWSE_AGENT_DEADLINE_MS - 30_000);
        gate();
        await Promise.all(first);
        const out = JSON.parse(await late);
        expect(out).toMatchObject({ status: "error", steps: 0 });
        expect(out.error).toContain("parallel browser slot");
        expect(isolated.mock.calls.some((c) => String(c[0]).includes("-z5-"))).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("a hung closeSession does not hold the run past the close timeout", async () => {
      vi.useFakeTimers();
      try {
        closeSession.mockImplementation(() => new Promise(() => {}));
        gate();
        const run = start("f1");
        await vi.advanceTimersByTimeAsync(20_000);
        await run;
        expect(browseRunCounts().active).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
