import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PanelClient,
  TAB_CLOSED_ERROR,
  CALL_TIMEOUT_MARGIN_MS,
  CONTEXT_TIMEOUT_MS,
  PRE_START_TIMEOUT_MS,
  type CallFailure,
} from "../panelClient";
import { appendLikedReferences } from "../panelRuntime";
import { attachScriptedCanvas, createFakeCanvasBridge, tab, type FakeCanvasBridge } from "./fakeCanvasBridge";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const errorOf = (raw: string) => (JSON.parse(raw) as { error: string }).error;

let fake: FakeCanvasBridge;
let client: PanelClient;
const setup = (tabs = [tab(1)]) => {
  fake = createFakeCanvasBridge(tabs);
  client = new PanelClient({ bridge: fake.bridge, now: () => 42 });
  return fake;
};
afterEach(() => {
  client.dispose();
  vi.useRealTimers();
});

describe("binding", () => {
  it("binds the only canvas tab without opening one", async () => {
    setup([tab(7, 3)]);
    attachScriptedCanvas(fake);
    await client.callTool("s", "batch_design", {}, { toolCallId: "c1", timeoutMs: 1000 });
    expect(fake.openTab).not.toHaveBeenCalled();
    expect(client.getBinding("s")).toEqual({ tabId: 7, registrationId: 3 });
    expect(fake.posted[0].tabId).toBe(7);
    expect(fake.posted[0].env.sentAt).toBe(42);
  });

  it("binds the first of several tabs (most recently active)", async () => {
    setup([tab(5), tab(6), tab(8)]);
    attachScriptedCanvas(fake);
    await client.callTool("s", "batch_get", {}, { toolCallId: "c1", timeoutMs: 1000 });
    expect(client.getBinding("s")?.tabId).toBe(5);
  });

  it("opens a tab when there is none and binds it", async () => {
    setup([]);
    attachScriptedCanvas(fake);
    await client.callTool("s", "batch_get", {}, { toolCallId: "c1", timeoutMs: 1000 });
    expect(fake.openTab).toHaveBeenCalledTimes(1);
    expect(client.getBinding("s")).toEqual({ tabId: 100, registrationId: 1 });
  });

  it("binds with the registrationId openTab() resolved: no latch when the tab list lags behind", async () => {
    setup([]);
    fake.lagTabAnnouncements();
    attachScriptedCanvas(fake);
    const first = await client.callTool("s", "batch_design", {}, { toolCallId: "c1", timeoutMs: 1000 });
    expect(JSON.parse(first)).toEqual({ ok: true });
    expect(client.getBinding("s")).toEqual({ tabId: 100, registrationId: 1 });
    // The tab list now announces the tab (same registration): streams and calls still flow.
    fake.publishLaggedTabs();
    client.forwardFrame("s", "c2", "batch_design", { operations: "x" });
    await flush();
    expect(fake.ofKind("stream").some((m) => m.toolCallId === "c2")).toBe(true);
    const second = await client.callTool("s", "batch_design", {}, { toolCallId: "c2", timeoutMs: 1000 });
    expect(JSON.parse(second)).toEqual({ ok: true });
    expect(fake.openTab).toHaveBeenCalledTimes(1);
  });

  it("keeps one binding per chat", async () => {
    setup([tab(1), tab(2)]);
    attachScriptedCanvas(fake);
    await client.callTool("a", "t", {}, { toolCallId: "c1", timeoutMs: 1000 });
    fake.setTabs([tab(2), tab(1)]);
    await client.callTool("a", "t", {}, { toolCallId: "c2", timeoutMs: 1000 });
    expect(fake.posted.map((p) => p.tabId)).toEqual([1, 1]);
  });

  it("buffers the frames that arrive while openTab() is pending and flushes them in order, then the call", async () => {
    setup([]);
    const release = fake.holdOpen();
    attachScriptedCanvas(fake);
    client.forwardFrame("s", "b1", "batch_design", { operations: "a" });
    client.forwardFrame("s", "b1", "batch_design", { operations: "ab" });
    client.forwardFrame("s", "b1", "batch_design", { operations: "abc" });
    const call = client.callTool("s", "batch_design", { operations: "abc" }, { toolCallId: "b1", timeoutMs: 1000 });
    await flush();
    expect(fake.openTab).toHaveBeenCalledTimes(1);
    expect(fake.posted).toHaveLength(0);
    release();
    await call;
    const kinds = fake.kinds();
    expect(kinds).toEqual(["stream", "stream", "stream", "stream-end", "call"]);
    const seqs = fake.ofKind("stream").map((m) => m.seq);
    expect(seqs).toEqual([0, 1, 2]);
    expect(fake.ofKind("stream")[0].format).toBe("full");
  });

  it("the first frame alone opens the canvas tab (live preview from the first delta)", async () => {
    setup([]);
    client.forwardFrame("s", "b1", "batch_design", { operations: "x" });
    await flush();
    await flush();
    expect(fake.openTab).toHaveBeenCalledTimes(1);
    expect(fake.kinds()).toEqual(["stream"]);
  });
});

describe("calls", () => {
  it("round trip: posts the call with the tool budget and resolves the tab's result", async () => {
    setup();
    attachScriptedCanvas(fake, { onCall: (name, input) => JSON.stringify({ name, input }) });
    const result = await client.callTool("s", "batch_design", { operations: "o" }, { toolCallId: "c1", timeoutMs: 5000 });
    expect(JSON.parse(result)).toEqual({ name: "batch_design", input: { operations: "o" } });
    expect(fake.ofKind("call")[0]).toMatchObject({ callId: "c1", toolName: "batch_design", timeoutMs: 5000 });
  });

  it("resolves an error after timeoutMs + 2 s and not before", async () => {
    vi.useFakeTimers();
    setup();
    const p = client.callTool("s", "batch_design", {}, { toolCallId: "c1", timeoutMs: 5000 });
    let settled = false;
    void p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    fake.emit(1, { kind: "started", callId: "c1" });
    await vi.advanceTimersByTimeAsync(5000 + CALL_TIMEOUT_MARGIN_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(errorOf(await p)).toMatch(/timed out/);
    // Like an abort, a timeout tells the tab to drop the call.
    expect(fake.ofKind("cancel")).toEqual([{ kind: "cancel", callId: "c1" }]);
  });

  it("charges no binding / openTab() time to the timeout: the budget starts at the post", async () => {
    vi.useFakeTimers();
    setup([]);
    const release = fake.holdOpen();
    const p = client.callTool("s", "batch_design", {}, { toolCallId: "c1", timeoutMs: 5000 });
    let settled = false;
    void p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(60_000); // way past timeoutMs + 2 s, tab still opening
    expect(settled).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.ofKind("call")).toHaveLength(1);
    fake.emit(100, { kind: "started", callId: "c1" });
    await vi.advanceTimersByTimeAsync(5000 + CALL_TIMEOUT_MARGIN_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(errorOf(await p)).toMatch(/timed out/);
  });

  it("does not time out a call queued behind another for longer than its budget; the budget starts on started", async () => {
    vi.useFakeTimers();
    setup();
    const p = client.callTool("s", "batch_design", {}, { toolCallId: "q1", timeoutMs: 5000 });
    let settled = false;
    void p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(5000 + CALL_TIMEOUT_MARGIN_MS + 60_000); // queued in the tab
    expect(settled).toBe(false);
    expect(fake.ofKind("cancel")).toHaveLength(0);
    fake.emit(1, { kind: "started", callId: "q1" });
    await vi.advanceTimersByTimeAsync(5000 + CALL_TIMEOUT_MARGIN_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(errorOf(await p)).toMatch(/timed out/);
  });

  it("a call that never starts is freed by the pre-start safety net, and abort still cancels at once", async () => {
    vi.useFakeTimers();
    setup();
    const p = client.callTool("s", "batch_design", {}, { toolCallId: "n1", timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(PRE_START_TIMEOUT_MS - 1);
    fake.emit(1, { kind: "result", callId: "other", result: "x" });
    await vi.advanceTimersByTimeAsync(2);
    expect(errorOf(await p)).toMatch(/timed out/);
    const ac = new AbortController();
    const p2 = client.callTool("s", "batch_design", {}, { toolCallId: "n2", timeoutMs: 5000, signal: ac.signal });
    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    expect(errorOf(await p2)).toMatch(/abort/i);
  });

  it("abort resolves an error, posts cancel and ignores the late result", async () => {
    setup();
    const ac = new AbortController();
    const p = client.callTool("s", "batch_design", {}, { toolCallId: "c1", timeoutMs: 5000, signal: ac.signal });
    await flush();
    ac.abort();
    expect(errorOf(await p)).toMatch(/abort/i);
    expect(fake.ofKind("cancel")).toEqual([{ kind: "cancel", callId: "c1" }]);
    fake.emit(1, { kind: "result", callId: "c1", result: "late" });
  });

  it("an already aborted signal never posts", async () => {
    setup();
    const ac = new AbortController();
    ac.abort();
    expect(errorOf(await client.callTool("s", "t", {}, { toolCallId: "c1", timeoutMs: 1, signal: ac.signal }))).toMatch(/abort/i);
    expect(fake.posted).toHaveLength(0);
  });

  it("a main error for the envelope resolves an error result", async () => {
    setup();
    fake.onPost(({ tabId, env }) => queueMicrotask(() => fake.emit(tabId, { kind: "error", refId: env.id, error: "no such tab" })));
    expect(errorOf(await client.callTool("s", "t", {}, { toolCallId: "c1", timeoutMs: 1000 }))).toBe("no such tab");
  });

  it("a main error for a tab missing from the list latches the binding, so the next call rebinds", async () => {
    setup([tab(1), tab(2)]);
    let fail = true;
    fake.onPost(({ tabId, env }) => {
      if (fail && env.msg.kind === "call") {
        fake.setTabs([tab(2)]); // tab 1 vanished without a tab-gone
        queueMicrotask(() => fake.emit(tabId, { kind: "error", refId: env.id, error: "unknown tab" }));
      }
    });
    expect(errorOf(await client.callTool("s", "t", {}, { toolCallId: "e1", timeoutMs: 1000 }))).toBe("unknown tab");
    await flush();
    expect(client.getBinding("s")).toBeNull();
    fail = false;
    attachScriptedCanvas(fake);
    await client.callTool("s", "t", {}, { toolCallId: "e2", timeoutMs: 1000 });
    expect(client.getBinding("s")).toEqual({ tabId: 2, registrationId: 1 });
  });

  it("a main error for a tab that is still listed keeps the binding", async () => {
    setup();
    fake.onPost(({ tabId, env }) => queueMicrotask(() => fake.emit(tabId, { kind: "error", refId: env.id, error: "busy" })));
    await client.callTool("s", "t", {}, { toolCallId: "e1", timeoutMs: 1000 });
    await flush();
    expect(client.getBinding("s")).toEqual({ tabId: 1, registrationId: 1 });
  });
});

describe("failure reports (analytics seam)", () => {
  const failures: CallFailure[] = [];
  const setupReporting = (tabs = [tab(1)]) => {
    failures.length = 0;
    fake = createFakeCanvasBridge(tabs);
    client = new PanelClient({ bridge: fake.bridge, now: () => 42, onCallFailed: (f) => failures.push(f) });
  };

  it("reports nothing when the tab answered, even with a tool error", async () => {
    setupReporting();
    attachScriptedCanvas(fake, { onCall: () => JSON.stringify({ error: "nodeId is required" }) });
    await client.callTool("s", "t", {}, { toolCallId: "r1", timeoutMs: 1000 });
    expect(failures).toEqual([]);
  });

  it("reports tab-gone, main error, timeout and bind failure once each; not aborts", async () => {
    setupReporting();
    const p1 = client.callTool("s", "a", {}, { toolCallId: "r1", timeoutMs: 1000 });
    await flush();
    fake.closeTab(1);
    await p1;
    expect(failures.map((f) => [f.toolName, f.kind])).toEqual([["a", "tab_gone"]]);

    setupReporting();
    fake.onPost(({ tabId, env }) => queueMicrotask(() => fake.emit(tabId, { kind: "error", refId: env.id, error: "x" })));
    await client.callTool("s", "b", {}, { toolCallId: "r2", timeoutMs: 1000 });
    expect(failures.map((f) => [f.toolName, f.kind])).toEqual([["b", "main_error"]]);

    vi.useFakeTimers();
    setupReporting();
    const p3 = client.callTool("s", "c", {}, { toolCallId: "r3", timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    fake.emit(1, { kind: "started", callId: "r3" });
    await vi.advanceTimersByTimeAsync(1000 + CALL_TIMEOUT_MARGIN_MS);
    await p3;
    expect(failures.map((f) => [f.toolName, f.kind])).toEqual([["c", "timeout"]]);
    vi.useRealTimers();

    setupReporting([]);
    fake.openTab.mockRejectedValueOnce(new Error("no tab"));
    await client.callTool("s", "d", {}, { toolCallId: "r4", timeoutMs: 1000 });
    expect(failures.map((f) => [f.toolName, f.kind])).toEqual([["d", "bind_failed"]]);

    setupReporting();
    const ac = new AbortController();
    const p5 = client.callTool("s", "e", {}, { toolCallId: "r5", timeoutMs: 1000, signal: ac.signal });
    await flush();
    ac.abort();
    await p5;
    expect(failures).toEqual([]);
  });
});

describe("tab-gone latch", () => {
  it("fails pending calls at once, drops later frames, never reopens the stream and clears the binding", async () => {
    setup([tab(1, 4)]);
    client.forwardFrame("s", "b1", "batch_design", { operations: "a" });
    const pending = client.callTool("s", "other", {}, { toolCallId: "c2", timeoutMs: 60_000 });
    await flush();
    const before = fake.posted.length;
    fake.closeTab(1);
    expect(await pending).toBe(TAB_CLOSED_ERROR);
    expect(client.getBinding("s")).toBeNull();
    client.forwardFrame("s", "b1", "batch_design", { operations: "ab" });
    client.forwardFrame("s", "b1", "batch_design", { operations: "abc" });
    await flush();
    expect(fake.posted).toHaveLength(before);
    expect(fake.openTab).not.toHaveBeenCalled();
  });

  it("does not post to a latched registration even if the tab list still shows it", async () => {
    setup([tab(1, 1)]);
    attachScriptedCanvas(fake);
    await client.callTool("s", "t", {}, { toolCallId: "c1", timeoutMs: 1000 });
    fake.emit(1, { kind: "tab-gone", registrationId: 1 });
    const before = fake.posted.length;
    // The stale list still has tab 1 / reg 1: it must not be bound again.
    await client.callTool("s", "t", {}, { toolCallId: "c2", timeoutMs: 1000 });
    expect(fake.posted.slice(before).every((p) => p.tabId !== 1)).toBe(true);
    expect(fake.openTab).toHaveBeenCalledTimes(1);
  });

  it("a reloaded tab (same tabId, new registrationId) is usable again", async () => {
    setup([tab(1, 1)]);
    attachScriptedCanvas(fake);
    await client.callTool("s", "t", {}, { toolCallId: "c1", timeoutMs: 1000 });
    fake.reloadTab(1);
    expect(client.getBinding("s")).toBeNull();
    const result = await client.callTool("s", "t", {}, { toolCallId: "c2", timeoutMs: 1000 });
    expect(JSON.parse(result)).toEqual({ ok: true });
    expect(client.getBinding("s")).toEqual({ tabId: 1, registrationId: 2 });
    expect(fake.openTab).not.toHaveBeenCalled();
  });

  it("notices a reload that tab-gone has not announced yet (registrationId changed in the list)", async () => {
    setup([tab(1, 1)]);
    attachScriptedCanvas(fake);
    await client.callTool("s", "t", {}, { toolCallId: "c1", timeoutMs: 1000 });
    fake.setTabs([tab(1, 2)]);
    await client.callTool("s", "t", {}, { toolCallId: "c2", timeoutMs: 1000 });
    expect(client.getBinding("s")).toEqual({ tabId: 1, registrationId: 2 });
  });
});

describe("streaming", () => {
  it("appends on growth and answers a resync with a full frame", async () => {
    setup();
    const canvas = attachScriptedCanvas(fake);
    client.forwardFrame("s", "b1", "batch_design", { operations: "a" });
    await flush();
    client.forwardFrame("s", "b1", "batch_design", { operations: "ab" });
    expect(fake.ofKind("stream").map((m) => m.format)).toEqual(["full", "append"]);
    fake.emit(1, { kind: "resync", toolCallId: "b1" });
    client.forwardFrame("s", "b1", "batch_design", { operations: "abc" });
    expect(fake.ofKind("stream").map((m) => m.format)).toEqual(["full", "append", "full"]);
    expect(canvas.inputs.at(-1)?.input).toEqual({ operations: "abc" });
  });

  it("endStream sends stream-end once and later frames for the call are dropped", async () => {
    setup();
    client.forwardFrame("s", "b1", "batch_design", { operations: "a" });
    await flush();
    client.endStream("b1", "abandoned");
    client.endStream("b1", "abandoned");
    client.forwardFrame("s", "b1", "batch_design", { operations: "ab" });
    expect(fake.kinds()).toEqual(["stream", "stream-end"]);
    expect(fake.posted[1].env.msg).toMatchObject({ reason: "abandoned" });
  });

  it("callTool closes its own stream as complete", async () => {
    setup();
    attachScriptedCanvas(fake);
    client.forwardFrame("s", "b1", "batch_design", { operations: "a" });
    await flush();
    await client.callTool("s", "batch_design", { operations: "ab" }, { toolCallId: "b1", timeoutMs: 1000 });
    expect(fake.kinds()).toEqual(["stream", "stream-end", "call"]);
  });
});

describe("requestContext", () => {
  it("is null without a binding and never opens a tab or posts", async () => {
    setup([]);
    expect(await client.requestContext("s", "m")).toBeNull();
    expect(fake.openTab).not.toHaveBeenCalled();
    expect(fake.posted).toHaveLength(0);
  });

  it("returns the bound tab's context, sending the chat id and model", async () => {
    setup();
    attachScriptedCanvas(fake, { context: '{"roots":[]}' });
    await client.callTool("s", "t", {}, { toolCallId: "c1", timeoutMs: 1000 });
    expect(await client.requestContext("s", "model-x")).toBe('{"roots":[]}');
    expect(fake.ofKind("context-request")[0]).toMatchObject({ sessionId: "s", model: "model-x" });
  });

  it("is null after 2 s without an answer", async () => {
    setup();
    attachScriptedCanvas(fake);
    await client.callTool("s", "t", {}, { toolCallId: "c1", timeoutMs: 1000 });
    vi.useFakeTimers();
    const p = client.requestContext("s", "m");
    await vi.advanceTimersByTimeAsync(CONTEXT_TIMEOUT_MS);
    expect(await p).toBeNull();
  });

  it("keeps sending the last good context when a later request fails", async () => {
    setup();
    let answer = true;
    attachScriptedCanvas(fake); // answers the call; the context requests are scripted below
    fake.onPost(({ tabId, env }) => {
      const msg = env.msg;
      if (msg.kind === "context-request" && answer) {
        queueMicrotask(() => fake.emit(tabId, { kind: "context-response", reqId: msg.reqId, canvasContext: '{"roots":["v1"]}' }));
      }
    });
    await client.callTool("s", "t", {}, { toolCallId: "c1", timeoutMs: 1000 });
    expect(await client.requestContext("s", "m")).toBe('{"roots":["v1"]}');
    answer = false;
    vi.useFakeTimers();
    const timedOut = client.requestContext("s", "m");
    await vi.advanceTimersByTimeAsync(CONTEXT_TIMEOUT_MS);
    expect(await timedOut).toBe('{"roots":["v1"]}');
    vi.useRealTimers();
  });

  it("tab-gone clears the remembered context (a closed document's context is never sent); a plain failure keeps it", async () => {
    setup();
    attachScriptedCanvas(fake, { context: '{"roots":["v1"]}' });
    await client.callTool("s", "t", {}, { toolCallId: "c1", timeoutMs: 1000 });
    expect(await client.requestContext("s", "m")).toBe('{"roots":["v1"]}');
    fake.closeTab(1);
    expect(await client.requestContext("s", "m")).toBeNull();
    expect(fake.openTab).not.toHaveBeenCalled();
  });

  it("a new chat binds passively to an existing tab for its first context, never opening one", async () => {
    setup([tab(1), tab(2)]);
    attachScriptedCanvas(fake, { context: '{"roots":["tab1"]}' });
    expect(await client.requestContext("fresh", "m")).toBe('{"roots":["tab1"]}');
    expect(client.getBinding("fresh")).toEqual({ tabId: 1, registrationId: 1 });
    expect(fake.posted.every((p) => p.tabId === 1)).toBe(true);
    expect(fake.openTab).not.toHaveBeenCalled();
  });

  it("is null when the tab goes away meanwhile", async () => {
    setup();
    attachScriptedCanvas(fake);
    await client.callTool("s", "t", {}, { toolCallId: "c1", timeoutMs: 1000 });
    const p = client.requestContext("s", "m");
    fake.closeTab(1);
    expect(await p).toBeNull();
  });
});

describe("placeNode", () => {
  it("sends place-node and resolves the parsed answer", async () => {
    setup();
    attachScriptedCanvas(fake, { onPlace: () => JSON.stringify({ id: "n9", x: 10, y: 20 }) });
    const r = await client.placeNode("s", { type: "embed" }, { size: { width: 1, height: 2 } });
    expect(r).toEqual({ id: "n9", x: 10, y: 20 });
    expect(fake.ofKind("place-node")[0]).toMatchObject({ node: { type: "embed" }, options: { size: { width: 1, height: 2 } } });
  });

  it("surfaces the canvas tab's error", async () => {
    setup();
    attachScriptedCanvas(fake, { onPlace: () => JSON.stringify({ error: "read-only" }) });
    expect(await client.placeNode("s", {}, {})).toEqual({ error: "read-only" });
  });

  it.each([
    ["a missing y", { id: "n", x: 1 }],
    ["a numeric id", { id: 5, x: 1, y: 2 }],
    ["string coordinates", { id: "n", x: "1", y: "2" }],
    ["an unrelated object", { ok: true }],
    ["null", null],
    ["a number", 7],
  ])("rejects %s as a placement", async (_label, answer) => {
    setup();
    attachScriptedCanvas(fake, { onPlace: () => JSON.stringify(answer) });
    expect(await client.placeNode("s", {}, {})).toEqual({ error: expect.stringMatching(/invalid placement/) });
  });

  it("aborts with cancel", async () => {
    setup();
    const ac = new AbortController();
    const p = client.placeNode("s", {}, {}, ac.signal);
    await flush();
    ac.abort();
    expect(await p).toEqual({ error: expect.stringMatching(/abort/i) });
    expect(fake.ofKind("cancel")).toHaveLength(1);
  });
});

describe("appendLikedReferences", () => {
  const refs = [{ url: "https://a/1.png" }];

  it("puts likedReferences last and is deterministic", () => {
    const ctx = '{"roots":[],"likedReferences":[{"url":"stale"}],"variables":[]}';
    const out = appendLikedReferences(ctx, refs);
    expect(Object.keys(JSON.parse(out))).toEqual(["roots", "variables", "likedReferences"]);
    expect(appendLikedReferences(ctx, refs)).toBe(out);
  });

  it("omits the key when the chat has none, and leaves non-JSON alone", () => {
    expect(appendLikedReferences('{"roots":[],"likedReferences":[{"url":"x"}]}', [])).toBe('{"roots":[]}');
    expect(appendLikedReferences("not json", refs)).toBe("not json");
  });
});
