import { afterEach, describe, expect, it, vi } from "vitest";
import { openCanvasTab } from "../openCanvasTab";
import { getPanelClient, panelCallTool, resetPanelRuntimeForTests } from "@/lib/canvasLink/panelRuntime";
import { attachScriptedCanvas, createFakeCanvasBridge, tab } from "@/lib/canvasLink/__tests__/fakeCanvasBridge";

type PanelApi = NonNullable<Window["penAgentPanel"]>;

function installPanel(tabs = [tab(1), tab(2)]) {
  const fake = createFakeCanvasBridge(tabs);
  window.penAgentPanel = { version: 2, canvas: fake.bridge, browser: {} as PanelApi["browser"] };
  return fake;
}
const run = async (args: unknown, ctx: Record<string, unknown> = { sessionId: "chat" }) =>
  JSON.parse(await openCanvasTab(args as never, ctx as never));
const call = (id: string) => panelCallTool("chat", "batch_get", {}, { toolCallId: id, timeoutMs: 1000 });

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
    const fake = installPanel();
    const seen: number[] = [];
    attachScriptedCanvas(fake, { onCall: () => "ok" });
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
    const fake = installPanel();
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

  it("does not bind when aborted while the tab opens", async () => {
    const fake = installPanel();
    const release = fake.holdOpen();
    const ac = new AbortController();
    const p = run({ target: "new" }, { sessionId: "chat", signal: ac.signal });
    ac.abort();
    release();
    expect((await p).error).toBeTruthy();
    expect(getPanelClient()!.getBinding("chat")).toBeNull();
  });
});
