// SPIKE(ipc-streaming): the chat tab forwards a streamed batch_design to the
// canvas tab; the scene is changed only through the canvas side.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { buildCanvasContext, executeToolCall, getToolCallTimeoutMs, useDesignChat } from "@/hooks/useDesignChat";
import { getStreamingToolAdapter } from "@/lib/streamingTools";
import { createSpikeRuntime } from "@/lib/surfaceSpike/runtime";
import { createLoopback } from "@/lib/surfaceSpike/__tests__/loopback";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";

function sse() {
  const encoder = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => (ctl = c) });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
    }),
    push: (chunk: Record<string, unknown>) => ctl.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)),
    close: () => {
      ctl.enqueue(encoder.encode("data: [DONE]\n\n"));
      ctl.close();
    },
  };
}

function textTurn(): Response {
  const done = sse();
  for (const c of [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: "done" },
    { type: "text-end", id: "t" },
    { type: "finish-step" },
    { type: "finish" },
  ]) done.push(c);
  done.close();
  return done.response;
}

const flush = (ms = 30) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const named = (name: string) => Object.values(useSceneStore.getState().nodesById).filter((n) => n.name === name);

describe("useDesignChat as the spike chat tab", () => {
  const disposers: Array<() => void> = [];
  beforeEach(() => {
    resetStores();
    seedScene();
  });
  afterEach(() => {
    disposers.splice(0).forEach((d) => d());
    vi.unstubAllGlobals();
  });

  function connect() {
    const lb = createLoopback();
    const deps = {
      toolTimeoutMs: getToolCallTimeoutMs,
      getAdapter: getStreamingToolAdapter,
      executeToolCall: (name: string, input: unknown, context: { sessionId: string; toolCallId: string }) =>
        executeToolCall(name, input, context, "chat"),
      buildCanvasContext: () => (buildCanvasContext() as { canvasContext: string }).canvasContext,
      contextVersion: () => "v",
    };
    const canvas = createSpikeRuntime({ ...deps, bridge: lb.canvas });
    const chat = createSpikeRuntime({ ...deps, bridge: lb.chat });
    disposers.push(canvas.dispose, chat.dispose);
    canvas.api.setRole("canvas");
    chat.api.setRole("chat");
    return { lb, canvas, chat };
  }

  it("streams batch_design to the canvas tab, which creates the nodes and returns the tool result", async () => {
    const { lb, canvas, chat } = connect();
    const first = sse();
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) return first.response;
      return textTurn();
    });
    vi.stubGlobal("fetch", fetchMock);
    const pastBefore = useHistoryStore.getState().past.length;
    const { result } = renderHook(() => useDesignChat({ sessionId: "spike-chat" }));
    act(() => result.current.setInput("build"));
    await act(async () => void result.current.sendMessage());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // The request asked the canvas tab for its context first.
    expect(lb.log.some((l) => l.env.msg.kind === "context-request")).toBe(true);
    expect(canvas.api.stats().received["context-request"]?.count).toBe(1);

    first.push({ type: "start" });
    first.push({ type: "start-step" });
    first.push({ type: "tool-input-start", toolCallId: "b1", toolName: "batch_design" });
    first.push({
      type: "tool-input-delta",
      toolCallId: "b1",
      inputTextDelta: '{"operations":"c=I(document, {type: \\"frame\\", name: \\"Remote\\", width: 100, height: 100})\\n',
    });
    await flush();
    // Applied by the canvas side from forwarded partial input, before the call completes.
    await waitFor(() => expect(named("Remote")).toHaveLength(1));
    expect(useHistoryStore.getState().past.length).toBe(pastBefore);
    expect(canvas.api.stats().received.stream?.count).toBeGreaterThan(0);
    expect(chat.api.stats().sent.stream?.count).toBeGreaterThan(0);

    const operations = 'c=I(document, {type: "frame", name: "Remote", width: 100, height: 100})\n';
    await act(async () => {
      first.push({ type: "tool-input-available", toolCallId: "b1", toolName: "batch_design", input: { operations } });
      first.push({ type: "finish-step" });
      first.push({ type: "finish" });
      first.close();
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await waitFor(() => expect(result.current.status).toBe("ready"), { timeout: 5000 });

    expect(named("Remote")).toHaveLength(1);
    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
    expect(lb.log.map((l) => l.env.msg.kind)).toContain("call");
    expect(lb.log.filter((l) => l.env.msg.kind === "result")).toHaveLength(1);
    // The continuation carried the canvas tab's tool result.
    expect(JSON.stringify(bodies[1].messages)).toContain("b1");
  });

  it("resolves the pending tool call with an error when the canvas tab disappears", async () => {
    const { lb } = connect();
    const first = sse();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++calls === 1 ? first.response : textTurn())));
    const { result } = renderHook(() => useDesignChat({ sessionId: "spike-gone" }));
    act(() => result.current.setInput("build"));
    await act(async () => void result.current.sendMessage());
    await waitFor(() => expect(lb.log.some((l) => l.env.msg.kind === "context-request")).toBe(true));
    // A tool that never answers on the canvas side.
    lb.muteCanvas = true;
    await act(async () => {
      first.push({ type: "start" });
      first.push({ type: "tool-input-available", toolCallId: "g1", toolName: "batch_design", input: { operations: "" } });
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() => expect(lb.log.some((l) => l.env.msg.kind === "call")).toBe(true));
    act(() => lb.killCanvas());
    await waitFor(() => {
      const part = result.current.messages.at(-1)?.parts.find((p) => p.type === "tool-batch_design") as
        | { state?: string; output?: string }
        | undefined;
      expect(part?.state).toBe("output-available");
      expect(JSON.parse(String(part?.output)).error).toMatch(/canvas/);
    });
    await act(async () => {
      first.push({ type: "finish-step" });
      first.push({ type: "finish" });
      first.close();
    });
    await waitFor(() => expect(result.current.status).toBe("ready"), { timeout: 5000 });
  });
});
