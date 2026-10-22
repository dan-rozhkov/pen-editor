import { afterEach, describe, expect, it, vi } from "vitest";
import { openCanvasTab } from "../openCanvasTab";
import { getPanelClient, panelCallTool, resetPanelRuntimeForTests, withPanelCanvasContext } from "@/lib/canvasLink/panelRuntime";
import { attachScriptedCanvas, createFakeCanvasBridge, tab } from "@/lib/canvasLink/__tests__/fakeCanvasBridge";

type PanelApi = NonNullable<Window["penAgentPanel"]>;

function installPanel(tabs = [tab(1), tab(2)], answerContext = true) {
  const fake = createFakeCanvasBridge(tabs);
  // Every tab answers `context-request` (a bind prefetches the new tab's context).
  if (answerContext) attachScriptedCanvas(fake, { context: "{}" });
  window.penAgentPanel = { version: 2, canvas: fake.bridge, browser: {} as PanelApi["browser"] };
  return fake;
}
const run = async (args: unknown, ctx: Record<string, unknown> = { sessionId: "chat" }) =>
  JSON.parse(await openCanvasTab(args as never, ctx as never));
const call = (id: string) => panelCallTool("chat", "batch_design", {}, { toolCallId: id, timeoutMs: 1000 });

afterEach(() => {
  resetPanelRuntimeForTests();
  delete window.penAgentPanel;
  vi.restoreAllMocks();
});

describe("open_canvas_tab", () => {
  it("errors outside the agent panel", async () => {
    expect(await run({ target: "new" })).toEqual({
      error: "open_canvas_tab works only in the desktop app's agent panel.",
    });
  });

  it("rejects a bad target", async () => {
    installPanel();
    expect((await run({ target: "x" })).error).toBeTruthy();
  });

  it("current: binds to the first tab and activates it", async () => {
    const fake = installPanel();
    const activate = vi.spyOn(fake.bridge, "activateTab");
    expect(await run({ target: "current" })).toEqual({ tabId: 1, title: "Tab 1", opened: false });
    expect(activate).toHaveBeenCalledWith(1);
    expect(fake.openTab).not.toHaveBeenCalled();
    expect(getPanelClient()!.getBinding("chat")).toEqual({ tabId: 1, registrationId: 1 });
  });

  it("current: opens a tab when there is none", async () => {
    const fake = installPanel([]);
    const r = await run({ target: "current" });
    expect(r).toMatchObject({ tabId: 100, opened: true });
    expect(fake.openTab).toHaveBeenCalledWith({ activate: true });
  });

  it("new: opens, rebinds, sends later calls to the new tab and does not latch the old one", async () => {
    const fake = installPanel(undefined, false);
    attachScriptedCanvas(fake, { onCall: () => "ok", context: "{}" });
    const seen: number[] = [];
    fake.onPost(({ tabId, env }) => {
      if (env.msg.kind === "call") seen.push(tabId);
    });
    await call("c1"); // binds to tab 1
    const r = await run({ target: "new" });
    expect(r).toMatchObject({ tabId: 100, opened: true });
    await call("c2");
    expect(seen).toEqual([1, 100]);
    // Old tab still usable by another chat (hide the new tab from the list).
    fake.setTabs(fake.tabs.filter((t) => t.tabId !== 100));
    const other = await panelCallTool("other", "batch_get", {}, { toolCallId: "c3", timeoutMs: 1000 });
    expect(other).toBe("ok");
    expect(seen[2]).toBe(1);
  });

  it("new: clears the remembered context so the next request carries the new tab's", async () => {
    const fake = installPanel(undefined, false);
    fake.onPost(({ tabId, env }) => {
      if (env.msg.kind !== "context-request") return;
      const reqId = env.msg.reqId;
      const canvasContext = tabId === 100 ? '{"d":"new"}' : '{"d":"old"}';
      queueMicrotask(() => fake.emit(tabId, { kind: "context-response", reqId, canvasContext }));
    });
    const client = getPanelClient()!;
    expect(await client.requestContext("chat", "m")).toBe('{"d":"old"}');
    await run({ target: "new" });
    expect(await client.requestContext("chat", "m")).toBe('{"d":"new"}');
  });

  it("respects an aborted signal", async () => {
    const fake = installPanel();
    const ac = new AbortController();
    ac.abort();
    const r = await run({ target: "new" }, { sessionId: "chat", signal: ac.signal });
    expect(r.error).toBeTruthy();
    expect(fake.openTab).not.toHaveBeenCalled();
    expect(getPanelClient()!.getBinding("chat")).toBeNull();
  });

  it("an abort that lands after openTab() resolved still binds the opened tab and succeeds", async () => {
    const fake = installPanel([]);
    const release = fake.holdOpen();
    const ac = new AbortController();
    const p = run({ target: "new" }, { sessionId: "chat", signal: ac.signal });
    await vi.waitFor(() => expect(fake.openTab).toHaveBeenCalled());
    ac.abort();
    release();
    expect(await p).toMatchObject({ tabId: 100, opened: true });
    expect(getPanelClient()!.getBinding("chat")).toEqual({ tabId: 100, registrationId: 1 });
  });

  it("current: an abort before the call runs never switches the user's tab", async () => {
    const fake = installPanel();
    const activate = vi.spyOn(fake.bridge, "activateTab");
    const ac = new AbortController();
    const release = fake.holdOpen(); // keeps the first bind busy so the aborted call waits its turn
    const first = run({ target: "new" }, { sessionId: "chat" });
    const p = run({ target: "current" }, { sessionId: "chat", signal: ac.signal });
    await vi.waitFor(() => expect(fake.openTab).toHaveBeenCalled());
    ac.abort();
    release();
    await first;
    expect((await p).error).toBeTruthy();
    expect(activate).not.toHaveBeenCalled(); // not even the tab the first call opened and bound
    expect(fake.openTab).toHaveBeenCalledTimes(1);
  });

  it("current: a latched tab is not activated", async () => {
    const fake = installPanel([tab(1)]);
    const activate = vi.spyOn(fake.bridge, "activateTab");
    getPanelClient();
    fake.emit(1, { kind: "tab-gone", registrationId: 1 });
    const r = await run({ target: "current" });
    expect(r).toMatchObject({ opened: true }); // the latched tab is skipped, a new one opens
    expect(activate).not.toHaveBeenCalledWith(1);
  });

  it("concurrent open_canvas_tab(current) and a canvas tool frame open ONE tab", async () => {
    const fake = installPanel([]);
    const release = fake.holdOpen();
    const seen: number[] = [];
    fake.onPost(({ tabId, env }) => {
      if (env.msg.kind === "call") seen.push(tabId);
    });
    const callP = call("c1");
    const explicit = run({ target: "current" });
    await vi.waitFor(() => expect(fake.openTab).toHaveBeenCalledTimes(1));
    release();
    const [result] = await Promise.all([explicit, callP]);
    expect(fake.openTab).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ tabId: 100 });
    expect(seen).toEqual([100]);
    expect(getPanelClient()!.getBinding("chat")).toEqual({ tabId: 100, registrationId: 1 });
  });

  it("two parallel open_canvas_tab(new) open TWO tabs: an explicit new never joins another bind", async () => {
    const fake = installPanel([]);
    const release = fake.holdOpen();
    const a = run({ target: "new" });
    const b = run({ target: "new" });
    await vi.waitFor(() => expect(fake.openTab).toHaveBeenCalledTimes(1));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(fake.openTab).toHaveBeenCalledTimes(2);
    expect(ra).toMatchObject({ tabId: 100, opened: true });
    expect(rb).toMatchObject({ tabId: 101, opened: true });
    expect(getPanelClient()!.getBinding("chat")).toEqual({ tabId: 101, registrationId: 1 });
  });

  it("a later (not concurrent) new still opens a fresh tab", async () => {
    const fake = installPanel([]);
    await run({ target: "new" });
    await run({ target: "new" });
    expect(fake.openTab).toHaveBeenCalledTimes(2);
    expect(getPanelClient()!.getBinding("chat")).toEqual({ tabId: 101, registrationId: 1 });
  });

  it("primes the new tab's context during the bind, before any request of the chat asks for it", async () => {
    const fake = installPanel(undefined, false);
    const asked: number[] = [];
    fake.onPost(({ tabId, env }) => {
      if (env.msg.kind !== "context-request") return;
      asked.push(tabId);
      const reqId = env.msg.reqId;
      const canvasContext = tabId === 100 ? '{"d":"new"}' : '{"d":"old"}';
      queueMicrotask(() => fake.emit(tabId, { kind: "context-response", reqId, canvasContext }));
    });
    await run({ target: "new" });
    expect(asked).toEqual([100]);
  });

  it("falls back to an empty scene context ({}), not to none, when the new tab does not answer", async () => {
    vi.useFakeTimers();
    try {
      installPanel([tab(1)], false); // nobody answers context requests
      const p = run({ target: "current" });
      await vi.advanceTimersByTimeAsync(2100);
      expect(await p).toMatchObject({ tabId: 1 });
      const remote = getPanelClient()!.requestContext("chat", "m");
      await vi.advanceTimersByTimeAsync(2100);
      expect(await remote).toBe("{}");
      const withCtx = withPanelCanvasContext("chat", { model: "m" });
      await vi.advanceTimersByTimeAsync(2100);
      expect(await withCtx).toEqual({ model: "m", canvasContext: "{}" });
    } finally {
      vi.useRealTimers();
    }
  });
});
