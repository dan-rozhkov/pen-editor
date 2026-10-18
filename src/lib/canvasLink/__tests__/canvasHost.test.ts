import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCanvasContext } from "@/hooks/useDesignChat";
import { toolHandlers, type ToolHandler } from "@/lib/toolRegistry";
import { useChatStore } from "@/store/chatStore";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSharedViewStore } from "@/store/sharedViewStore";
import { streamingToolAdapters } from "@/lib/streamingTools";
import { resetStores, seedScene } from "@/test/fixtures";
import { AppendEncoder } from "../appendCodec";
import { resetChatModeForTests } from "@/lib/chatMode";
import { maybeStartCanvasHost, startCanvasHost } from "../canvasHost";
import { buildSceneContext } from "../sceneContext";
import type {
  CanvasHostBridge,
  CanvasToChatMsg,
  ChatToCanvasMsg,
  LinkEnvelope,
  MainToCanvasMsg,
} from "../protocol";

function fakeBridge() {
  const posted: CanvasToChatMsg[] = [];
  let listener: ((env: LinkEnvelope<ChatToCanvasMsg | MainToCanvasMsg>) => void) | null = null;
  const bridge: CanvasHostBridge = {
    register: vi.fn(),
    unregister: vi.fn(),
    post: (env) => posted.push(env.msg),
    onMessage: (cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
  };
  let n = 0;
  const send = (msg: ChatToCanvasMsg | MainToCanvasMsg) => listener?.({ id: `t${++n}`, sentAt: 0, msg });
  return { bridge, posted, send, hasListener: () => listener !== null };
}

const resultFor = (posted: CanvasToChatMsg[], callId: string) =>
  posted.find((m) => m.kind === "result" && m.callId === callId) as
    | Extract<CanvasToChatMsg, { kind: "result" }>
    | undefined;

const namedCount = (name: string) =>
  Object.values(useSceneStore.getState().nodesById).filter((n) => n.name === name).length;

const OPS_1 = 'card=I(document, {type: "frame", name: "Card", width: 100, height: 100})\n';
const OPS_2 = 'card2=I(document, {type: "frame", name: "Card2", width: 50, height: 50})\n';

describe("canvas host", () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    resetStores();
    seedScene();
    useEditorModeStore.getState().exitToEdit();
    useSharedViewStore.getState().setSharedView(false);
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  function start() {
    const f = fakeBridge();
    stop = startCanvasHost(f.bridge);
    return f;
  }

  function streamBatch(f: ReturnType<typeof fakeBridge>, operations: string, enc: AppendEncoder) {
    const msg = enc.encode({ operations });
    if (msg) f.send(msg);
  }

  it("registers once on start; stop unregisters, stops listening and clears adapter sessions", () => {
    const clears = streamingToolAdapters.map((a) => vi.spyOn(a, "onSessionClear"));
    const f = start();
    expect(f.bridge.register).toHaveBeenCalledTimes(1);
    expect(f.hasListener()).toBe(true);
    stop?.();
    stop = undefined;
    expect(f.hasListener()).toBe(false);
    expect(f.bridge.unregister).toHaveBeenCalledTimes(1);
    for (const c of clears) expect(c).toHaveBeenCalledWith("canvas-link");
  });

  it("keeps the tool name after stream-end complete: a later abandoned still rolls back", () => {
    const f = start();
    const pastBefore = useHistoryStore.getState().past.length;
    const enc = new AppendEncoder("b4", "batch_design");
    streamBatch(f, OPS_1, enc);
    expect(namedCount("Card")).toBe(1);
    f.send({ kind: "stream-end", toolCallId: "b4", reason: "complete" });
    expect(namedCount("Card")).toBe(1);
    f.send({ kind: "stream-end", toolCallId: "b4", reason: "abandoned" });
    expect(namedCount("Card")).toBe(0);
    expect(useHistoryStore.getState().past.length).toBe(pastBefore);
  });

  it("stop abandons a completed stream whose call never arrived", () => {
    const f = start();
    const enc = new AppendEncoder("b5", "batch_design");
    streamBatch(f, OPS_1, enc);
    f.send({ kind: "stream-end", toolCallId: "b5", reason: "complete" });
    expect(namedCount("Card")).toBe(1);
    stop?.();
    stop = undefined;
    expect(namedCount("Card")).toBe(0);
  });

  it("stays up across edit <-> view toggles (no unregister) and finishes a running call", async () => {
    let release: (() => void) | undefined;
    toolHandlers.__toggle_test__ = () => new Promise<string>((resolve) => (release = () => resolve("done")));
    try {
      const f = start();
      f.send({ kind: "call", callId: "t1", toolName: "__toggle_test__", input: {}, timeoutMs: 5000 });
      await vi.waitFor(() => expect(release).toBeDefined());
      useEditorModeStore.getState().enterView();
      useEditorModeStore.getState().exitToEdit();
      expect(f.bridge.unregister).not.toHaveBeenCalled();
      expect(f.hasListener()).toBe(true);
      release?.();
      await vi.waitFor(() => expect(resultFor(f.posted, "t1")?.result).toBe("done"));
      // and it serves again after the toggle
      f.send({ kind: "context-request", reqId: "x", sessionId: "s", model: "m" });
      expect(f.posted.some((m) => m.kind === "context-response")).toBe(true);
    } finally {
      delete toolHandlers.__toggle_test__;
    }
  });

  it("refuses streams and mutating calls once the canvas stops being editable", async () => {
    const f = start();
    useEditorModeStore.getState().enterView();
    const enc = new AppendEncoder("b6", "batch_design");
    streamBatch(f, OPS_1, enc);
    expect(namedCount("Card")).toBe(0);
    f.send({
      kind: "call",
      callId: "m1",
      toolName: "batch_design",
      input: { operations: OPS_1 },
      timeoutMs: 1000,
    });
    f.send({ kind: "place-node", callId: "m2", node: { type: "rect" } });
    await vi.waitFor(() => expect(resultFor(f.posted, "m2")).toBeDefined());
    await vi.waitFor(() => expect(resultFor(f.posted, "m1")).toBeDefined());
    expect(resultFor(f.posted, "m1")?.result).toContain("not editable");
    expect(resultFor(f.posted, "m2")?.result).toContain("not editable");
    expect(namedCount("Card")).toBe(0);
  });

  it("applies streamed batch_design mid-stream and commits once with one undo entry", async () => {
    const f = start();
    const pastBefore = useHistoryStore.getState().past.length;
    const enc = new AppendEncoder("b1", "batch_design");
    streamBatch(f, OPS_1, enc);
    expect(namedCount("Card")).toBe(1);
    streamBatch(f, OPS_1 + OPS_2, enc);
    expect(namedCount("Card2")).toBe(1);
    expect(useHistoryStore.getState().past.length).toBe(pastBefore);

    f.send({ kind: "stream-end", toolCallId: "b1", reason: "complete" });
    f.send({
      kind: "call",
      callId: "b1",
      toolName: "batch_design",
      input: { operations: OPS_1 + OPS_2 },
      timeoutMs: 5000,
    });
    await vi.waitFor(() => expect(resultFor(f.posted, "b1")).toBeDefined());
    expect(namedCount("Card")).toBe(1);
    expect(namedCount("Card2")).toBe(1);
    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
  });

  it("answers resync on a seq gap and recovers on the next full", () => {
    const f = start();
    const enc = new AppendEncoder("b2", "batch_design");
    streamBatch(f, OPS_1, enc);
    enc.encode({ operations: OPS_1 + OPS_2 }); // dropped on the wire
    streamBatch(f, OPS_1 + OPS_2 + OPS_2.replace("card2", "card3").replace("Card2", "Card3"), enc);
    expect(f.posted).toContainEqual({ kind: "resync", toolCallId: "b2" });
    expect(namedCount("Card2")).toBe(0);
    enc.forceFull();
    streamBatch(f, OPS_1 + OPS_2 + "x", enc);
    expect(namedCount("Card2")).toBe(1);
  });

  it("rolls back an abandoned stream like the local path", () => {
    const f = start();
    const pastBefore = useHistoryStore.getState().past.length;
    const enc = new AppendEncoder("b3", "batch_design");
    streamBatch(f, OPS_1, enc);
    expect(namedCount("Card")).toBe(1);
    f.send({ kind: "stream-end", toolCallId: "b3", reason: "abandoned" });
    expect(namedCount("Card")).toBe(0);
    expect(useHistoryStore.getState().past.length).toBe(pastBefore);
  });

  describe("calls", () => {
    const TOOL = "__canvas_link_test__";
    let original: ToolHandler | undefined;
    beforeEach(() => {
      original = toolHandlers[TOOL];
    });
    afterEach(() => {
      if (original) toolHandlers[TOOL] = original;
      else delete toolHandlers[TOOL];
    });

    it("posts the handler result and an error for an unknown tool", async () => {
      toolHandlers[TOOL] = async () => "fine";
      const f = start();
      f.send({ kind: "call", callId: "c1", toolName: TOOL, input: {}, timeoutMs: 1000 });
      f.send({ kind: "call", callId: "c2", toolName: "nope_tool", input: {}, timeoutMs: 1000 });
      await vi.waitFor(() => expect(resultFor(f.posted, "c2")).toBeDefined());
      expect(resultFor(f.posted, "c1")?.result).toBe("fine");
      expect(resultFor(f.posted, "c2")?.result).toContain("error");
    });

    it("aborts the handler's signal on cancel and still answers", async () => {
      let signal: AbortSignal | undefined;
      toolHandlers[TOOL] = (_args, ctx) =>
        new Promise<string>((resolve, reject) => {
          signal = ctx?.signal;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
          void resolve;
        });
      const f = start();
      f.send({ kind: "call", callId: "c3", toolName: TOOL, input: {}, timeoutMs: 5000 });
      await vi.waitFor(() => expect(signal).toBeDefined());
      expect(signal?.aborted).toBe(false);
      f.send({ kind: "cancel", callId: "c3" });
      expect(signal?.aborted).toBe(true);
      await vi.waitFor(() => expect(resultFor(f.posted, "c3")).toBeDefined());
      expect(resultFor(f.posted, "c3")?.result).toContain("error");
    });

    it("does not run a call cancelled while it waits in the queue", async () => {
      let release: (() => void) | undefined;
      const ran = vi.fn();
      toolHandlers[TOOL] = () => new Promise<string>((resolve) => (release = () => resolve("first")));
      toolHandlers[`${TOOL}2`] = async () => {
        ran();
        return "second";
      };
      const f = start();
      f.send({ kind: "call", callId: "q1", toolName: TOOL, input: {}, timeoutMs: 5000 });
      await vi.waitFor(() => expect(release).toBeDefined());
      f.send({ kind: "call", callId: "q2", toolName: `${TOOL}2`, input: {}, timeoutMs: 5000 });
      f.send({ kind: "cancel", callId: "q2" });
      release?.();
      await vi.waitFor(() => expect(resultFor(f.posted, "q2")).toBeDefined());
      expect(ran).not.toHaveBeenCalled();
      expect(resultFor(f.posted, "q2")?.result).toContain("error");
      expect(resultFor(f.posted, "q1")?.result).toBe("first");
      delete toolHandlers[`${TOOL}2`];
    });

    it("starts the message's budget inside the queue, not at receipt", async () => {
      let release: (() => void) | undefined;
      toolHandlers[TOOL] = () => new Promise<string>((resolve) => (release = () => resolve("slow")));
      toolHandlers[`${TOOL}2`] = async () => "quick";
      const f = start();
      f.send({ kind: "call", callId: "w1", toolName: TOOL, input: {}, timeoutMs: 5000 });
      await vi.waitFor(() => expect(release).toBeDefined());
      f.send({ kind: "call", callId: "w2", toolName: `${TOOL}2`, input: {}, timeoutMs: 30 });
      await new Promise((r) => setTimeout(r, 80)); // longer than w2's budget, spent waiting
      release?.();
      await vi.waitFor(() => expect(resultFor(f.posted, "w2")).toBeDefined());
      expect(resultFor(f.posted, "w2")?.result).toBe("quick");
      delete toolHandlers[`${TOOL}2`];
    });

    it("ignores a duplicate callId that is still running and answers once", async () => {
      let release: (() => void) | undefined;
      const handler = vi.fn(() => new Promise<string>((resolve) => (release = () => resolve("done"))));
      toolHandlers[TOOL] = handler;
      const f = start();
      f.send({ kind: "call", callId: "d1", toolName: TOOL, input: {}, timeoutMs: 5000 });
      await vi.waitFor(() => expect(release).toBeDefined());
      f.send({ kind: "call", callId: "d1", toolName: TOOL, input: {}, timeoutMs: 5000 });
      release?.();
      await vi.waitFor(() => expect(resultFor(f.posted, "d1")).toBeDefined());
      await new Promise((r) => setTimeout(r, 20));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(f.posted.filter((m) => m.kind === "result" && m.callId === "d1")).toHaveLength(1);
      expect(resultFor(f.posted, "d1")?.result).toBe("done");
    });

    it("honors the message's timeoutMs even when the handler hangs", async () => {
      let signal: AbortSignal | undefined;
      toolHandlers[TOOL] = (_args, ctx) => {
        signal = ctx?.signal;
        return new Promise<string>(() => {});
      };
      const f = start();
      f.send({ kind: "call", callId: "c4", toolName: TOOL, input: {}, timeoutMs: 30 });
      await vi.waitFor(() => expect(resultFor(f.posted, "c4")).toBeDefined());
      expect(resultFor(f.posted, "c4")?.result).toBe('{"error":"Tool call timed out"}');
      expect(signal?.aborted).toBe(true);
      expect(f.posted.filter((m) => m.kind === "result" && m.callId === "c4")).toHaveLength(1);
    });

    it("posts started when the handler really starts, not for a call cancelled while queued", async () => {
      let release: (() => void) | undefined;
      toolHandlers[TOOL] = () => new Promise<string>((resolve) => (release = () => resolve("first")));
      toolHandlers[`${TOOL}2`] = async () => "second";
      const f = start();
      f.send({ kind: "call", callId: "s1", toolName: TOOL, input: {}, timeoutMs: 5000 });
      await vi.waitFor(() => expect(release).toBeDefined());
      f.send({ kind: "call", callId: "s2", toolName: `${TOOL}2`, input: {}, timeoutMs: 5000 });
      f.send({ kind: "call", callId: "s3", toolName: `${TOOL}2`, input: {}, timeoutMs: 5000 });
      f.send({ kind: "cancel", callId: "s3" });
      const started = () => f.posted.filter((m) => m.kind === "started").map((m) => (m as { callId: string }).callId);
      expect(started()).toEqual(["s1"]); // s2 still queued behind s1
      release?.();
      await vi.waitFor(() => expect(resultFor(f.posted, "s3")).toBeDefined());
      await vi.waitFor(() => expect(resultFor(f.posted, "s2")).toBeDefined());
      expect(started()).toEqual(["s1", "s2"]);
      // started precedes the result of the same call
      expect(f.posted.findIndex((m) => m.kind === "started" && m.callId === "s2")).toBeLessThan(
        f.posted.findIndex((m) => m.kind === "result" && m.callId === "s2")
      );
      delete toolHandlers[`${TOOL}2`];
    });

    it("keeps the streamed state while the call is queued, hands it to the handler when it starts", async () => {
      let release: (() => void) | undefined;
      toolHandlers[TOOL] = () => new Promise<string>((resolve) => (release = () => resolve("first")));
      const f = start();
      f.send({ kind: "call", callId: "k1", toolName: TOOL, input: {}, timeoutMs: 5000 });
      await vi.waitFor(() => expect(release).toBeDefined());
      const enc = new AppendEncoder("k2", "batch_design");
      streamBatch(f, OPS_1, enc);
      f.send({ kind: "stream-end", toolCallId: "k2", reason: "complete" });
      f.send({ kind: "call", callId: "k2", toolName: "batch_design", input: { operations: OPS_1 }, timeoutMs: 5000 });
      expect(namedCount("Card")).toBe(1); // queued, still streamed
      release?.();
      await vi.waitFor(() => expect(resultFor(f.posted, "k2")).toBeDefined());
      expect(namedCount("Card")).toBe(1); // committed once, not duplicated
    });

    it("rolls back the streamed mutations of a call aborted while queued", async () => {
      let release: (() => void) | undefined;
      toolHandlers[TOOL] = () => new Promise<string>((resolve) => (release = () => resolve("first")));
      const f = start();
      f.send({ kind: "call", callId: "r1", toolName: TOOL, input: {}, timeoutMs: 5000 });
      await vi.waitFor(() => expect(release).toBeDefined());
      const enc = new AppendEncoder("r2", "batch_design");
      streamBatch(f, OPS_1, enc);
      f.send({ kind: "stream-end", toolCallId: "r2", reason: "complete" });
      expect(namedCount("Card")).toBe(1);
      f.send({ kind: "call", callId: "r2", toolName: "batch_design", input: { operations: OPS_1 }, timeoutMs: 5000 });
      f.send({ kind: "cancel", callId: "r2" });
      release?.();
      await vi.waitFor(() => expect(resultFor(f.posted, "r2")).toBeDefined());
      expect(resultFor(f.posted, "r2")?.result).toContain("cancelled");
      expect(namedCount("Card")).toBe(0);
    });

    it("rolls back the stream of a call that is refused (unknown tool)", async () => {
      const f = start();
      const abandons = streamingToolAdapters.map((a) => vi.spyOn(a, "onAbandon"));
      const enc = new AppendEncoder("u1", "batch_design");
      streamBatch(f, OPS_1, enc);
      expect(namedCount("Card")).toBe(1);
      f.send({ kind: "call", callId: "u1", toolName: "nope_tool", input: {}, timeoutMs: 1000 });
      await vi.waitFor(() => expect(resultFor(f.posted, "u1")).toBeDefined());
      expect(namedCount("Card")).toBe(0);
      expect(abandons.some((a) => a.mock.calls.some(([arg]) => arg.toolCallId === "u1"))).toBe(true);
    });

    it("panel-gone aborts running calls, never runs queued ones, rolls streams back and posts nothing", async () => {
      let release: (() => void) | undefined;
      let signal: AbortSignal | undefined;
      const queuedRan = vi.fn();
      toolHandlers[TOOL] = (_a, ctx) =>
        new Promise<string>((resolve) => {
          signal = ctx?.signal;
          release = () => resolve("late");
        });
      toolHandlers[`${TOOL}2`] = async () => {
        queuedRan();
        return "queued";
      };
      const f = start();
      f.send({ kind: "call", callId: "g1", toolName: TOOL, input: {}, timeoutMs: 5000 });
      await vi.waitFor(() => expect(release).toBeDefined());
      const enc = new AppendEncoder("g2", "batch_design");
      streamBatch(f, OPS_1, enc);
      const enc3 = new AppendEncoder("g3", "batch_design");
      streamBatch(f, OPS_2, enc3); // an open, never completed stream
      f.send({ kind: "stream-end", toolCallId: "g2", reason: "complete" });
      f.send({ kind: "call", callId: "g2", toolName: `${TOOL}2`, input: {}, timeoutMs: 5000 });
      expect(namedCount("Card")).toBe(1);
      expect(namedCount("Card2")).toBe(1);
      const before = f.posted.length;
      f.send({ kind: "panel-gone" });
      expect(signal?.aborted).toBe(true);
      expect(namedCount("Card")).toBe(0);
      expect(namedCount("Card2")).toBe(0);
      release?.();
      await new Promise((r) => setTimeout(r, 50));
      expect(queuedRan).not.toHaveBeenCalled();
      expect(f.posted.slice(before)).toEqual([]); // no result, no started, nothing
      delete toolHandlers[`${TOOL}2`];
    });
  });

  it("place-node adds the node and answers {id,x,y}", async () => {
    const f = start();
    f.send({
      kind: "place-node",
      callId: "p1",
      node: { id: "placed1", type: "rect", name: "Placed", width: 40, height: 30, fill: "#000000" },
      options: { size: { width: 40, height: 30 } },
    });
    await vi.waitFor(() => expect(resultFor(f.posted, "p1")).toBeDefined());
    const res = JSON.parse(resultFor(f.posted, "p1")!.result);
    expect(res.id).toBe("placed1");
    const node = useSceneStore.getState().nodesById.placed1 as unknown as { x: number; y: number };
    expect(node).toBeDefined();
    expect({ x: node.x, y: node.y }).toEqual({ x: res.x, y: res.y });
  });

  it("place-node generates an id when missing and rejects an existing id", async () => {
    const f = start();
    f.send({ kind: "place-node", callId: "p3", node: { type: "rect", name: "NoId", width: 5, height: 5 } });
    await vi.waitFor(() => expect(resultFor(f.posted, "p3")).toBeDefined());
    const res = JSON.parse(resultFor(f.posted, "p3")!.result);
    expect(typeof res.id).toBe("string");
    expect(res.id.length).toBeGreaterThan(0);
    expect(useSceneStore.getState().nodesById[res.id]).toBeDefined();

    f.send({ kind: "place-node", callId: "p4", node: { id: res.id, type: "rect", width: 5, height: 5 } });
    await vi.waitFor(() => expect(resultFor(f.posted, "p4")).toBeDefined());
    expect(JSON.parse(resultFor(f.posted, "p4")!.result)).toHaveProperty("error");
  });

  it("place-node without a string type answers an error and adds nothing", async () => {
    const f = start();
    const before = Object.keys(useSceneStore.getState().nodesById).length;
    f.send({ kind: "place-node", callId: "p5", node: { id: "x1", width: 5 } });
    await vi.waitFor(() => expect(resultFor(f.posted, "p5")).toBeDefined());
    expect(JSON.parse(resultFor(f.posted, "p5")!.result)).toHaveProperty("error");
    expect(Object.keys(useSceneStore.getState().nodesById).length).toBe(before);
  });

  it("place-node with an invalid node answers an error", async () => {
    const f = start();
    f.send({ kind: "place-node", callId: "p2", node: null });
    await vi.waitFor(() => expect(resultFor(f.posted, "p2")).toBeDefined());
    expect(JSON.parse(resultFor(f.posted, "p2")!.result)).toHaveProperty("error");
  });

  it("answers context-request with the JSON of the scene context, byte-stable", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] });
    const model = useChatStore.getState().model;
    const f = start();
    f.send({ kind: "context-request", reqId: "r1", sessionId: "s", model });
    f.send({ kind: "context-request", reqId: "r2", sessionId: "s", model });
    const [a, b] = f.posted.filter((m) => m.kind === "context-response") as Extract<
      CanvasToChatMsg,
      { kind: "context-response" }
    >[];
    expect(a.reqId).toBe("r1");
    expect(a.canvasContext).toBe(JSON.stringify(buildSceneContext({ model })));
    expect(b.canvasContext).toBe(a.canvasContext);
    // The local chat path sends the same string when no references are liked.
    expect(a.canvasContext).toBe((buildCanvasContext() as { canvasContext: string }).canvasContext);
  });
});

describe("maybeStartCanvasHost gate", () => {
  afterEach(() => {
    delete (window as { penDesktop?: unknown }).penDesktop;
    resetChatModeForTests();
  });

  it("does not register when the chat is enabled", () => {
    const f = fakeBridge();
    window.penDesktop = { onMenuCommand: () => () => {}, canvasHost: f.bridge };
    resetChatModeForTests();
    expect(maybeStartCanvasHost()).toBeNull();
    expect(f.bridge.register).not.toHaveBeenCalled();
  });

  it("does nothing without a bridge, even when chatless", () => {
    window.penDesktop = { onMenuCommand: () => () => {}, agentLayout: true };
    expect(maybeStartCanvasHost()).toBeNull();
  });

  it("never starts on the shared viewer, but does start in view mode (it refuses mutations itself)", () => {
    const f = fakeBridge();
    window.penDesktop = { onMenuCommand: () => () => {}, agentLayout: true, canvasHost: f.bridge };
    useSharedViewStore.getState().setSharedView(true);
    expect(maybeStartCanvasHost()).toBeNull();
    expect(f.bridge.register).not.toHaveBeenCalled();
    useSharedViewStore.getState().setSharedView(false);
    useEditorModeStore.getState().enterView();
    const stopFn = maybeStartCanvasHost();
    expect(stopFn).not.toBeNull();
    expect(f.bridge.register).toHaveBeenCalledTimes(1);
    stopFn?.();
    useEditorModeStore.getState().exitToEdit();
  });

  it("starts when chatless and the bridge exists", () => {
    const f = fakeBridge();
    window.penDesktop = { onMenuCommand: () => () => {}, agentLayout: true, canvasHost: f.bridge };
    const stopFn = maybeStartCanvasHost();
    expect(f.bridge.register).toHaveBeenCalledTimes(1);
    stopFn?.();
    expect(f.hasListener()).toBe(false);
  });
});
