// /agent in the desktop panel: the chat has no scene, canvas tools go to the canvas tab.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useDesignChat } from "@/hooks/useDesignChat";
import { useChatStore } from "@/store/chatStore";
import { useSceneStore } from "@/store/sceneStore";
import { getPanelClient, resetPanelRuntimeForTests } from "@/lib/canvasLink/panelRuntime";
import { attachScriptedCanvas, createFakeCanvasBridge, tab } from "@/lib/canvasLink/__tests__/fakeCanvasBridge";
import { resetStores } from "@/test/fixtures";
import { controlledSse, textTurn } from "@/test/sseStream";

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return { ...actual, track: trackMock };
});

const OPERATIONS = 'c=I(document, {type: "frame", name: "Remote", width: 100, height: 100})\n';

afterEach(() => {
  resetPanelRuntimeForTests();
  delete window.penAgentPanel;
  vi.unstubAllGlobals();
});

/** Sends one message in `sessionId` and returns the request bodies the backend saw. */
async function sendHello(sessionId: string): Promise<Array<Record<string, unknown>>> {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return textTurn();
    })
  );
  const { result } = renderHook(() => useDesignChat({ sessionId }));
  act(() => result.current.setInput("hi"));
  await act(async () => void result.current.sendMessage());
  await waitFor(() => expect(bodies).toHaveLength(1));
  return bodies;
}

describe("useDesignChat in the agent panel", () => {
  beforeEach(() => {
    resetStores();
    trackMock.mockClear();
  });

  it("forwards a streamed batch_design (frames + call), keeps the scene untouched and returns the tab's result", async () => {
    const fake = createFakeCanvasBridge([tab(1)]);
    const canvas = attachScriptedCanvas(fake, {
      context: '{"roots":[{"id":"r1"}]}',
      onCall: () => JSON.stringify({ success: true, from: "canvas tab" }),
    });
    window.penAgentPanel = { version: 2, canvas: fake.bridge };
    const sessionId = "panel-chat";
    useChatStore.setState({ likedReferences: { [sessionId]: [{ url: "https://r/1.png" }] } } as never);

    const first = controlledSse();
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1 ? first.response : textTurn();
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDesignChat({ sessionId }));
    // Bind the chat first, as an earlier canvas tool of the conversation would have.
    await act(async () => {
      await getPanelClient()!.callTool(sessionId, "batch_get", {}, { toolCallId: "pre", timeoutMs: 1000 });
    });

    act(() => result.current.setInput("build"));
    await act(async () => void result.current.sendMessage());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // The request body carries the canvas tab's context, chat-side likedReferences last.
    const ctx = JSON.parse(String(bodies[0].canvasContext));
    expect(ctx.roots).toEqual([{ id: "r1" }]);
    expect(Object.keys(ctx).at(-1)).toBe("likedReferences");

    first.push({ type: "start" });
    first.push({ type: "start-step" });
    first.push({ type: "tool-input-start", toolCallId: "b1", toolName: "batch_design" });
    first.push({
      type: "tool-input-delta",
      toolCallId: "b1",
      inputTextDelta: '{"operations":"c=I(document, {type: \\"frame\\", name: \\"Remote\\", width: 100, height: 100})\\n',
    });
    await waitFor(() => expect(canvas.inputs.some((i) => i.toolCallId === "b1")).toBe(true));
    expect(Object.keys(useSceneStore.getState().nodesById)).toHaveLength(0);

    await act(async () => {
      first.push({ type: "tool-input-available", toolCallId: "b1", toolName: "batch_design", input: { operations: OPERATIONS } });
      first.push({ type: "finish-step" });
      first.push({ type: "finish" });
      first.close();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await waitFor(() => expect(result.current.status).toBe("ready"), { timeout: 5000 });

    expect(fake.kinds().filter((k) => k === "stream").length).toBeGreaterThan(0);
    expect(fake.ofKind("call").filter((c) => c.callId === "b1")).toHaveLength(1);
    expect(fake.kinds().indexOf("stream-end")).toBeLessThan(fake.kinds().lastIndexOf("call"));
    // Nothing ran locally.
    expect(Object.keys(useSceneStore.getState().nodesById)).toHaveLength(0);
    // The continuation carries the canvas tab's tool result.
    expect(JSON.stringify(bodies[1].messages)).toContain("canvas tab");
  });

  it("sends an existing canvas tab's context on the first message of a new chat (passive bind, no tab opened)", async () => {
    const fake = createFakeCanvasBridge([tab(1)]);
    attachScriptedCanvas(fake, { context: '{"roots":[{"id":"existing"}]}' });
    window.penAgentPanel = { version: 2, canvas: fake.bridge };
    const bodies = await sendHello("fresh-chat");
    expect(JSON.parse(String(bodies[0].canvasContext)).roots).toEqual([{ id: "existing" }]);
    expect(fake.openTab).not.toHaveBeenCalled();
  });

  it("sends no canvasContext when there is no canvas tab, and opens none", async () => {
    const fake = createFakeCanvasBridge([]);
    window.penAgentPanel = { version: 2, canvas: fake.bridge };
    const bodies = await sendHello("unbound");
    expect(bodies[0]).not.toHaveProperty("canvasContext");
    expect(bodies[0].model).toBeDefined();
    expect(fake.posted).toHaveLength(0);
    expect(fake.openTab).not.toHaveBeenCalled();
  });

  it.each([
    ["success", JSON.stringify({ success: true })],
    ["a tool error", JSON.stringify({ error: "nodeId is required" })],
    ["the tab's own timeout", JSON.stringify({ error: "Tool call timed out" })],
  ])("the panel emits NO agent_tool_executed for a call the tab answered (the tab's executeToolCall does): %s", async (_label, tabResult) => {
    const fake = createFakeCanvasBridge([tab(1)]);
    attachScriptedCanvas(fake, { onCall: () => tabResult, context: "{}" });
    window.penAgentPanel = { version: 2, canvas: fake.bridge };
    await runOneCanvasToolTurn("analytics-chat");
    expect(trackMock.mock.calls.filter(([name]) => name === "agent_tool_executed")).toHaveLength(0);
  });

  it("emits one canvas-link agent_tool_executed for a call that never reached the tab handler (main error)", async () => {
    const fake = createFakeCanvasBridge([tab(1)]);
    fake.onPost(({ tabId, env }) => {
      const msg = env.msg;
      if (msg.kind === "context-request") {
        queueMicrotask(() => fake.emit(tabId, { kind: "context-response", reqId: msg.reqId, canvasContext: "{}" }));
      } else if (msg.kind === "call") {
        queueMicrotask(() => fake.emit(tabId, { kind: "error", refId: env.id, error: "gone" }));
      }
    });
    window.penAgentPanel = { version: 2, canvas: fake.bridge };
    await runOneCanvasToolTurn("analytics-chat-2");
    const events = trackMock.mock.calls.filter(([name]) => name === "agent_tool_executed");
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({
      tool_name: "batch_get",
      source: "canvas-link",
      ok: false,
      error_kind: "canvas_link_main_error",
      duration_ms: expect.any(Number),
    });
  });

  async function runOneCanvasToolTurn(sessionId: string) {
    const first = controlledSse();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++calls === 1 ? first.response : textTurn())));
    const { result } = renderHook(() => useDesignChat({ sessionId }));
    act(() => result.current.setInput("go"));
    await act(async () => void result.current.sendMessage());
    await waitFor(() => expect(calls).toBe(1));
    await act(async () => {
      first.push({ type: "start" });
      first.push({ type: "start-step" });
      first.push({ type: "tool-input-available", toolCallId: "g1", toolName: "batch_get", input: {} });
      first.push({ type: "finish-step" });
      first.push({ type: "finish" });
      first.close();
    });
    await waitFor(() => expect(calls).toBe(2), { timeout: 5000 });
  }
});

describe("a launch from a canvas tab in the agent panel", () => {
  beforeEach(() => resetStores());

  it("sends the launch text in a new chat bound to the sending tab, with that tab's canvasContext", async () => {
    const fake = createFakeCanvasBridge([tab(1), tab(2, 4)]);
    attachScriptedCanvas(fake, { context: '{"roots":[],"selectedIds":["n1"]}' });
    window.penAgentPanel = { version: 2, canvas: fake.bridge };
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return textTurn();
      })
    );
    getPanelClient();
    fake.emit(2, { kind: "launch", launchId: "L", payload: { text: "make it blue" } });
    await waitFor(() => expect(useChatStore.getState().activeChatId).not.toBeNull());
    const sessionId = useChatStore.getState().activeChatId!;
    await waitFor(() => expect(getPanelClient()!.getBinding(sessionId)).toEqual({ tabId: 2, registrationId: 4 }));
    renderHook(() => useDesignChat({ sessionId }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.stringify(bodies[0].messages)).toContain("make it blue");
    expect(JSON.parse(String(bodies[0].canvasContext)).selectedIds).toEqual(["n1"]);
    expect(fake.ofKind("context-request").every((m) => m.sessionId === sessionId)).toBe(true);
    expect(fake.posted.filter((p) => p.tabId === 2).length).toBeGreaterThan(0);
    expect(fake.posted.some((p) => p.tabId === 1)).toBe(false);
  });
});
