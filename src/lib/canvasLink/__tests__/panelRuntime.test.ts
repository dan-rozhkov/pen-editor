import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBrowserBridge, isDesktopBrowserAvailable } from "@/lib/tools/browser/bridge";
import { isolatedBrowseAvailable } from "@/lib/tools/browser/isolation";
import { useChatStore } from "@/store/chatStore";
import { browseCapture } from "@/lib/tools/browser/browseCapture";
import { browseScreenshot } from "@/lib/tools/browser/browseScreenshot";
import { placeNodeOnCanvas } from "@/lib/tools/browser/placeOnCanvas";
import {
  getPanelClient,
  isPanelCanvasLinkActive,
  panelRunsInCanvas,
  resetPanelRuntimeForTests,
  startPanelRuntime,
  withPanelCanvasContext,
} from "../panelRuntime";
import { attachScriptedCanvas, createFakeCanvasBridge, tab } from "./fakeCanvasBridge";

type PanelApi = NonNullable<Window["penAgentPanel"]>;
const browser = { isolated: () => ({}), assert: async () => ({}) } as unknown as PanelApi["browser"];

function installPanel(extra: Partial<PanelApi> = {}) {
  const fake = createFakeCanvasBridge([tab(1)]);
  window.penAgentPanel = { version: 2, canvas: fake.bridge, browser, ...extra };
  return fake;
}

afterEach(() => {
  resetPanelRuntimeForTests();
  delete window.penAgentPanel;
  vi.resetModules();
});

describe("panel browser bridge", () => {
  it("is picked up as the desktop browser (bridge, isolation, availability)", () => {
    installPanel();
    expect(isDesktopBrowserAvailable()).toBe(true);
    expect(getBrowserBridge("chat")).toBe(browser);
    expect(isolatedBrowseAvailable()).toBe(true);
    // An isolated QA session resolves through the panel bridge's `isolated()`.
    expect(getBrowserBridge("chat", "qa-session-1")).toBeDefined();
  });

  it("reports a desktop browser in the request capabilities", async () => {
    installPanel();
    vi.resetModules();
    const { CLIENT_CAPABILITIES } = await import("@/lib/chatTransport");
    expect(CLIENT_CAPABILITIES).toMatchObject({
      desktopBrowser: true,
      browser: "desktop",
      browseIsolation: true,
      browseAssert: true,
    });
  });

  it("advertises canvasTabs only in the panel with a canvas bridge", async () => {
    installPanel();
    vi.resetModules();
    expect((await import("@/lib/chatTransport")).CLIENT_CAPABILITIES.canvasTabs).toBe(true);
    delete window.penAgentPanel;
    vi.resetModules();
    expect((await import("@/lib/chatTransport")).CLIENT_CAPABILITIES.canvasTabs).toBe(false);
    window.penAgentPanel = { version: 1 };
    vi.resetModules();
    expect((await import("@/lib/chatTransport")).CLIENT_CAPABILITIES.canvasTabs).toBe(false);
  });

  it("without a panel bridge the cloud browser stays in charge", () => {
    window.penAgentPanel = { version: 2 };
    expect(isDesktopBrowserAvailable()).toBe(false);
  });
});

describe("panel seams", () => {
  it("are inert without a canvas bridge", () => {
    window.penAgentPanel = { version: 1 };
    expect(isPanelCanvasLinkActive()).toBe(false);
    expect(panelRunsInCanvas("batch_design")).toBe(false);
    expect(withPanelCanvasContext("s", { model: "m" })).toEqual({ model: "m" });
  });

  it("send canvas tools to the tab and keep browser tools in the panel", () => {
    installPanel();
    expect(panelRunsInCanvas("batch_design")).toBe(true);
    expect(panelRunsInCanvas("browse_open")).toBe(false);
    expect(panelRunsInCanvas("analyze_image")).toBe(false);
  });

  it("send no canvasContext when there is no canvas tab at all, and never open one for it", async () => {
    const fake = installPanel();
    fake.setTabs([]);
    const body = await withPanelCanvasContext("s", { canvasContext: '{"roots":[]}', model: "m" });
    expect(body).toEqual({ model: "m" });
    expect(fake.openTab).not.toHaveBeenCalled();
  });

  it("send only the chat's likedReferences (read from the store) when no scene context is available", async () => {
    const fake = installPanel();
    fake.setTabs([]);
    useChatStore.setState({
      likedReferences: { s: [{ url: "https://r/1.png", sourceUrl: "https://src", tool: "browse_screenshot" }] },
    } as never);
    const body = (await withPanelCanvasContext("s", { canvasContext: "ignored", model: "m" })) as {
      canvasContext: string;
    };
    expect(body.canvasContext).toBe(
      JSON.stringify({ likedReferences: [{ url: "https://r/1.png", sourceUrl: "https://src", tool: "browse_screenshot" }] })
    );
    // Another chat without liked references gets no field.
    expect(await withPanelCanvasContext("other", { model: "m" })).toEqual({ model: "m" });
    useChatStore.setState({ likedReferences: {} } as never);
  });

  it("replace the local context by the tab's, with the chat's likedReferences last", async () => {
    const fake = installPanel();
    attachScriptedCanvas(fake, { context: '{"roots":[{"id":"a"}],"selectedIds":[]}' });
    await getPanelClient()!.callTool("s", "batch_get", {}, { toolCallId: "c1", timeoutMs: 1000 });
    useChatStore.setState({ likedReferences: { s: [{ url: "https://r/1.png" }] } } as never);
    const local = { canvasContext: "local scene, replaced", model: "m", userId: "u" };
    const body = (await withPanelCanvasContext("s", local)) as { canvasContext: string; model: string };
    expect(body.model).toBe("m");
    expect(Object.keys(JSON.parse(body.canvasContext))).toEqual(["roots", "selectedIds", "likedReferences"]);
    expect(JSON.parse(body.canvasContext).roots).toEqual([{ id: "a" }]);
    expect(fake.ofKind("context-request")[0]).toMatchObject({ sessionId: "s", model: "m" });
    expect(((await withPanelCanvasContext("s", local)) as typeof body).canvasContext).toBe(body.canvasContext);
    useChatStore.setState({ likedReferences: {} } as never);
  });
});

describe("placeNodeOnCanvas in the panel", () => {
  const build = (pos: { x: number; y: number }) =>
    ({ id: "e1", type: "embed", name: "Page", x: pos.x, y: pos.y, width: 10, height: 20, htmlContent: "<p/>" }) as never;

  it("goes through place-node: node without position, options with the pair and size", async () => {
    const fake = installPanel();
    attachScriptedCanvas(fake, { onPlace: () => JSON.stringify({ id: "e1", x: 5, y: 6 }) });
    getPanelClient(); // installs the place-node redirect
    const placed = await placeNodeOnCanvas(100, 200, { width: 10, height: 20 }, build, undefined, "chat-1");
    expect(placed).toEqual({ id: "e1", x: 5, y: 6 });
    const msg = fake.ofKind("place-node")[0];
    expect(msg.node).toEqual({ id: "e1", type: "embed", name: "Page", width: 10, height: 20, htmlContent: "<p/>" });
    expect(msg.options).toEqual({ x: 100, y: 200, size: { width: 10, height: 20 } });
  });

  it("omits x/y unless both are numbers", async () => {
    const fake = installPanel();
    attachScriptedCanvas(fake);
    getPanelClient(); // installs the place-node redirect
    await placeNodeOnCanvas(100, undefined, { width: 1, height: 2 }, build, undefined, "chat-1");
    expect(fake.ofKind("place-node")[0].options).toEqual({ size: { width: 1, height: 2 } });
  });

  it("throws the canvas tab's error and returns undefined when already aborted", async () => {
    const fake = installPanel();
    attachScriptedCanvas(fake, { onPlace: () => JSON.stringify({ error: "read-only canvas" }) });
    getPanelClient(); // installs the place-node redirect
    await expect(placeNodeOnCanvas(1, 2, { width: 1, height: 1 }, build, undefined, "chat-1")).rejects.toThrow("read-only canvas");
    const ac = new AbortController();
    ac.abort();
    expect(await placeNodeOnCanvas(1, 2, { width: 1, height: 1 }, build, ac.signal, "chat-1")).toBeUndefined();
  });
});

describe("browser tools placing nodes in the panel", () => {
  const png = "data:image/png;base64,AAAA";
  const browserStub = (over: Record<string, unknown> = {}) =>
    ({
      isolated: () => ({}),
      assert: async () => ({}),
      screenshot: async () => ({ imageData: png, width: 10, height: 20, url: "https://e.com", title: "E" }),
      capture: async () => ({ html: "<p/>", width: 10, height: 20, url: "https://e.com", title: "E" }),
      ...over,
    }) as unknown as PanelApi["browser"];

  /** Two canvas tabs; chat A binds the first, chat B (bound after the list reorders) the second. */
  async function bindTwoChats() {
    const fake = installPanel({ browser: browserStub() });
    attachScriptedCanvas(fake);
    const client = getPanelClient()!;
    await client.callTool("chat-a", "batch_get", {}, { toolCallId: "a", timeoutMs: 1000 });
    fake.setTabs([tab(2), tab(1)]);
    await client.callTool("chat-b", "batch_get", {}, { toolCallId: "b", timeoutMs: 1000 });
    return fake;
  }

  it("a capture from a background chat goes to ITS bound tab, not the active chat's", async () => {
    const fake = await bindTwoChats();
    useChatStore.setState({ activeChatId: "chat-b" });
    await browseCapture({}, { sessionId: "chat-a" });
    await browseScreenshot({ placeOnCanvas: true }, { sessionId: "chat-a" });
    await browseCapture({}, { sessionId: "chat-b" });
    expect(fake.posted.filter((p) => p.env.msg.kind === "place-node").map((p) => p.tabId)).toEqual([1, 1, 2]);
  });

  it("without a session the active chat is used", async () => {
    const fake = await bindTwoChats();
    useChatStore.setState({ activeChatId: "chat-b" });
    await placeNodeOnCanvas(1, 2, { width: 1, height: 1 }, () => ({ id: "n", type: "embed" }) as never);
    expect(fake.posted.filter((p) => p.env.msg.kind === "place-node").map((p) => p.tabId)).toEqual([2]);
  });

  it("browse_screenshot keeps its capture and reports placeError when the tab refuses the node", async () => {
    const fake = installPanel({ browser: browserStub() });
    attachScriptedCanvas(fake, { onPlace: () => JSON.stringify({ error: "read-only canvas" }) });
    getPanelClient();
    const out = JSON.parse(await browseScreenshot({ placeOnCanvas: true }, { sessionId: "chat-1" }));
    expect(out.imageData).toBe(png);
    expect(out.placeError).toBe("read-only canvas");
    expect(out.placedNodeId).toBeUndefined();
  });

  it("browse_capture reports a refused placement as its error", async () => {
    const fake = installPanel({ browser: browserStub() });
    attachScriptedCanvas(fake, { onPlace: () => JSON.stringify({ error: "read-only canvas" }) });
    getPanelClient();
    await expect(browseCapture({}, { sessionId: "chat-1" })).rejects.toThrow("read-only canvas");
  });

  it("passes the tool's signal through: an aborted screenshot is reported, nothing is posted", async () => {
    const fake = installPanel({ browser: browserStub() });
    attachScriptedCanvas(fake);
    getPanelClient();
    const ac = new AbortController();
    const shot = browseScreenshot({ placeOnCanvas: true }, { sessionId: "chat-1", signal: ac.signal });
    ac.abort();
    const out = JSON.parse(await shot);
    expect(out.imageData).toBe(png);
    expect(out.placeError).toMatch(/abort/i);
    expect(fake.ofKind("place-node")).toHaveLength(0);
  });

  it("returns the placement the tab answered even if the signal aborted meanwhile", async () => {
    const fake = installPanel();
    const ac = new AbortController();
    fake.onPost(({ tabId, env }) => {
      if (env.msg.kind !== "place-node") return;
      fake.emit(tabId, { kind: "result", callId: env.msg.callId, result: JSON.stringify({ id: "n1", x: 3, y: 4 }) });
      ac.abort(); // the answer is in; the abort lands before the awaiting caller resumes
    });
    getPanelClient();
    const node = () => ({ id: "n1", type: "embed" }) as never;
    const placed = await placeNodeOnCanvas(1, 2, { width: 1, height: 1 }, node, ac.signal, "chat-1");
    expect(placed).toEqual({ id: "n1", x: 3, y: 4 });
  });
});

describe("launch from a canvas tab", () => {
  const launch = (fake: ReturnType<typeof installPanel>, tabId: number, payload: Record<string, unknown>, launchId = "l1") => {
    getPanelClient(); // creates the client
    fake.emit(tabId, { kind: "launch", launchId, payload } as never);
  };
  const acks = (fake: ReturnType<typeof installPanel>) => fake.ofKind("launch-ack");
  const settleFor = async (fake: ReturnType<typeof installPanel>, n = 1) => {
    await vi.waitFor(() => expect(acks(fake).length).toBeGreaterThanOrEqual(n));
  };
  const resetChats = () => useChatStore.setState({ chats: [], activeChatId: null, launchQueue: {} } as never);
  beforeEach(resetChats);

  it("creates a chat, binds it to the sending tab, queues the text and images and acks", async () => {
    const fake = installPanel();
    attachScriptedCanvas(fake, { context: "{}" });
    fake.setTabs([tab(1), tab(2, 5)]);
    resetChats();
    const images = [{ dataUrl: "data:image/png;base64,A", name: "n" }];
    launch(fake, 2, { text: "  hi  ", images }, "l1");
    await settleFor(fake);
    const { activeChatId, launchQueue, chats } = useChatStore.getState();
    expect(chats).toHaveLength(1);
    expect(launchQueue[activeChatId!]).toEqual({ text: "hi", images });
    expect(getPanelClient()!.getBinding(activeChatId!)).toEqual({ tabId: 2, registrationId: 5 });
    expect(fake.posted.find((p) => p.env.msg.kind === "launch-ack")).toMatchObject({
      tabId: 2,
      env: { msg: { kind: "launch-ack", launchId: "l1" } },
    });
    expect(acks(fake)[0]).not.toHaveProperty("error");
  });

  it("a launch arriving before any chat activity (startPanelRuntime on mount) creates the chat", async () => {
    const fake = installPanel();
    attachScriptedCanvas(fake, { context: "{}" });
    resetChats();
    startPanelRuntime(); // what AgentPage does on mount; no chat request was made
    fake.emit(1, { kind: "launch", launchId: "early", payload: { text: "first" } } as never);
    await settleFor(fake);
    const { activeChatId, launchQueue } = useChatStore.getState();
    expect(launchQueue[activeChatId!]).toEqual({ text: "first" });
  });

  it("startPanelRuntime does nothing outside the panel", () => {
    window.penAgentPanel = { version: 1 };
    startPanelRuntime();
    expect(window.penAgentPanel).toBeDefined();
  });

  it("ignores a repeated launchId and never reuses or rebinds an existing chat", async () => {
    const fake = installPanel();
    attachScriptedCanvas(fake, { context: "{}" });
    fake.setTabs([tab(1), tab(2)]);
    useChatStore.getState().createChat();
    const existing = useChatStore.getState().activeChatId!;
    launch(fake, 1, { text: "a" }, "l1");
    await settleFor(fake);
    launch(fake, 2, { text: "b" }, "l1");
    await settleFor(fake, 2); // the repeat is re-acked, not handled
    const { chats, activeChatId, launchQueue } = useChatStore.getState();
    expect(chats).toHaveLength(2);
    expect(activeChatId).not.toBe(existing);
    expect(launchQueue[existing]).toBeUndefined();
    expect(launchQueue[activeChatId!]).toEqual({ text: "a" });
    expect(getPanelClient()!.getBinding(existing)).toBeNull();
  });

  it("acks as soon as the chat is bound: a slow context prefetch is no false 'did not respond'", async () => {
    const fake = installPanel();
    const contextRequests: Array<{ reqId: string; model: string }> = [];
    fake.onPost(({ env }) => {
      if (env.msg.kind === "context-request") contextRequests.push(env.msg);
    });
    resetChats();
    launch(fake, 1, { text: "slow tab" }, "slow");
    await settleFor(fake); // acked while the tab has NOT answered the context request
    expect(contextRequests).toHaveLength(1);
    const chatId = useChatStore.getState().activeChatId!;
    expect(useChatStore.getState().launchQueue[chatId]).toBeUndefined(); // still priming
    fake.emit(1, { kind: "context-response", reqId: contextRequests[0].reqId, canvasContext: "{\"roots\":[]}" });
    await vi.waitFor(() => expect(useChatStore.getState().launchQueue[chatId]).toEqual({ text: "slow tab" }));
  });

  it("primes the context with the chat's own model, not an empty one", async () => {
    const fake = installPanel();
    const models: string[] = [];
    fake.onPost(({ env }) => {
      if (env.msg.kind === "context-request") models.push(env.msg.model);
    });
    attachScriptedCanvas(fake, { context: "{}" });
    resetChats();
    launch(fake, 1, { text: "m" }, "model");
    await vi.waitFor(() => expect(useChatStore.getState().launchQueue[useChatStore.getState().activeChatId!]).toBeDefined());
    const chat = useChatStore.getState().chats.find((c) => c.id === useChatStore.getState().activeChatId)!;
    expect(chat.model).toBeTruthy();
    expect(models).toEqual([chat.model]);
  });

  it("a launch refused after the bind step keeps the user's active chat and leaves no extra chat", async () => {
    const fake = installPanel();
    fake.setTabs([tab(1), tab(2)]);
    useChatStore.getState().createChat();
    const mine = useChatStore.getState().activeChatId!;
    const chatsBefore = useChatStore.getState().chats.map((c) => c.id);
    const list = fake.bridge.listTabs;
    let calls = 0;
    // The probe sees tab 2; by the time of the bind it is gone.
    fake.bridge.listTabs = async () => (++calls === 1 ? list() : [tab(1)]);
    launch(fake, 2, { text: "late" }, "vanish");
    await settleFor(fake);
    expect(acks(fake)[0]).toMatchObject({ launchId: "vanish", error: expect.any(String) });
    expect(useChatStore.getState().activeChatId).toBe(mine);
    expect(useChatStore.getState().chats.map((c) => c.id)).toEqual(chatsBefore);
    expect(useChatStore.getState().launchQueue).toEqual({});
  });

  it("forgets a chat's client state when the chat is closed", async () => {
    const fake = installPanel();
    attachScriptedCanvas(fake, { context: "{}" });
    const c = getPanelClient()!;
    const spy = vi.spyOn(c, "forgetSession");
    useChatStore.getState().createChat();
    const keep = useChatStore.getState().activeChatId!;
    useChatStore.getState().createChat();
    const gone = useChatStore.getState().activeChatId!;
    await c.bindTo(gone, 1);
    expect(c.getBinding(gone)).not.toBeNull();
    useChatStore.getState().closeChat(gone);
    expect(spy).toHaveBeenCalledWith(gone);
    expect(spy).not.toHaveBeenCalledWith(keep);
    expect(c.getBinding(gone)).toBeNull();
  });

  it("a retry with the same launchId (first ack late) creates no second chat and gets the same ack again", async () => {
    const fake = installPanel();
    attachScriptedCanvas(fake, { context: "{}" });
    launch(fake, 1, { text: "once" }, "same");
    await settleFor(fake);
    fake.emit(1, { kind: "launch", launchId: "same", payload: { text: "once" } } as never); // the tab's retry
    await settleFor(fake, 2);
    expect(acks(fake).map((a) => a.launchId)).toEqual(["same", "same"]);
    expect(acks(fake).every((a) => !("error" in a))).toBe(true);
    expect(useChatStore.getState().chats).toHaveLength(1);
  });

  it("a retry while the first launch is still priming its context is re-acked and not handled twice", async () => {
    const fake = installPanel(); // no scripted canvas: the context prime stays pending
    launch(fake, 1, { text: "slow" }, "busy");
    await settleFor(fake);
    fake.emit(1, { kind: "launch", launchId: "busy", payload: { text: "slow" } } as never);
    await settleFor(fake, 2);
    expect(useChatStore.getState().chats).toHaveLength(1);
  });

  it("a refused launch re-acks its error on a repeated launchId", async () => {
    const fake = installPanel();
    launch(fake, 9, { text: "lost" }, "refused");
    await settleFor(fake);
    fake.emit(9, { kind: "launch", launchId: "refused", payload: { text: "lost" } } as never);
    await settleFor(fake, 2);
    expect(acks(fake)).toHaveLength(2);
    for (const a of acks(fake)) expect(a).toMatchObject({ launchId: "refused", error: expect.any(String) });
    expect(useChatStore.getState().chats).toHaveLength(0);
  });

  it("keeps only the last 100 launch outcomes", async () => {
    const fake = installPanel();
    getPanelClient();
    for (let i = 0; i < 101; i++) fake.emit(9, { kind: "launch", launchId: `n${i}`, payload: { text: "" } } as never);
    await settleFor(fake, 101);
    fake.emit(9, { kind: "launch", launchId: "n100", payload: { text: "" } } as never); // remembered: re-acked
    fake.emit(9, { kind: "launch", launchId: "n0", payload: { text: "" } } as never); // forgotten: handled again
    await settleFor(fake, 103);
    expect(acks(fake)).toHaveLength(103);
  });

  it("a launch from an unlisted tab gets an error ack and shows nothing in the panel", async () => {
    const fake = installPanel();
    resetChats();
    const queueBefore = useChatStore.getState().launchQueue;
    launch(fake, 9, { text: "lost" }, "gone");
    await settleFor(fake);
    expect(acks(fake)[0]).toMatchObject({ launchId: "gone", error: expect.any(String) });
    expect(useChatStore.getState().chats).toHaveLength(0);
    expect(useChatStore.getState().launchQueue).toEqual(queueBefore);
  });

  it("a launch from a latched registration is refused and does not touch another tab's chat", async () => {
    const fake = installPanel();
    attachScriptedCanvas(fake, { context: "{}" });
    fake.setTabs([tab(1), tab(2)]);
    useChatStore.getState().createChat();
    const active = useChatStore.getState().activeChatId!;
    await getPanelClient()!.bindTo(active, 1);
    fake.emit(2, { kind: "tab-gone", registrationId: 1 });
    fake.setTabs([tab(1), tab(2)]);
    launch(fake, 2, { text: "x" }, "latched");
    await settleFor(fake);
    expect(acks(fake)[0]).toMatchObject({ launchId: "latched", error: expect.any(String) });
    expect(useChatStore.getState().launchQueue[active]).toBeUndefined();
    expect(getPanelClient()!.getBinding(active)).toEqual({ tabId: 1, registrationId: 1 });
  });

  it("acks an empty text with an error and creates nothing", async () => {
    const fake = installPanel();
    resetChats();
    launch(fake, 1, { text: "   " });
    await settleFor(fake);
    expect(acks(fake)[0]).toMatchObject({ error: expect.any(String) });
    expect(useChatStore.getState().chats).toHaveLength(0);
  });
});
