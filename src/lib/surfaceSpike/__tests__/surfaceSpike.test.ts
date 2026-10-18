import { describe, it, expect, vi, afterEach } from "vitest";
import { createLoopback } from "./loopback";
import { createSpikeRuntime, getSpikeChatSide, spikeForwardFrame, spikeForwards, spikeRequestBody } from "../runtime";
import { isCanvasTool } from "../types";
import { SpikeStatsCollector } from "../stats";
import type { StreamingToolFrame } from "@/lib/streamingTools/types";

function setup(overrides: { execute?: (name: string, input: unknown) => Promise<string>; context?: () => string } = {}) {
  const lb = createLoopback();
  const frames: StreamingToolFrame[] = [];
  const abandoned: string[] = [];
  const adapter = {
    toolName: "batch_design",
    onFrame: (f: StreamingToolFrame) => frames.push(f),
    onAbandon: (r: { toolCallId: string }) => abandoned.push(r.toolCallId),
    onSessionClear: () => {},
  };
  const common = {
    toolTimeoutMs: () => 50,
    getAdapter: () => adapter,
    executeToolCall: async (name: string, input: unknown) => (overrides.execute ?? (async () => "ok"))(name, input),
    buildCanvasContext: overrides.context ?? (() => '{"roots":[]}'),
    contextVersion: () => "v1",
    contextTimeoutMs: 40,
    callTimeoutMarginMs: 0,
  };
  const chat = createSpikeRuntime({ ...common, bridge: lb.chat });
  const canvas = createSpikeRuntime({ ...common, bridge: lb.canvas });
  return { lb, frames, abandoned, chat, canvas };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  // Leave the module-level chat side clean for the next test.
  createSpikeRuntime({ bridge: createLoopback().chat } as never).dispose();
});

describe("isCanvasTool", () => {
  it("excludes browser, QA, ask_user and analyze_image", () => {
    for (const n of ["browse_open", "browse_agent", "qa_assert", "ask_user", "analyze_image"]) {
      expect(isCanvasTool(n)).toBe(false);
    }
    for (const n of ["batch_design", "draw_vector", "get_screenshot", "set_export_settings"]) {
      expect(isCanvasTool(n)).toBe(true);
    }
  });
});

describe("no role set", () => {
  it("changes nothing: hooks decline and the body stays the same sync object", () => {
    const body = { canvasContext: "x" };
    expect(spikeForwards("batch_design")).toBe(false);
    expect(spikeForwardFrame("s", "batch_design", "t", {})).toBe(false);
    expect(spikeRequestBody(body)).toBe(body);
    expect(getSpikeChatSide()).toBeNull();
  });
});

describe("chat <-> canvas over the loopback", () => {
  it("replays a streamed input on the canvas side, then runs the call and returns the result", async () => {
    const execute = vi.fn(async () => "done");
    const { lb, frames, chat, canvas } = setup({ execute });
    canvas.api.setRole("canvas");
    chat.api.setRole("chat");
    expect(spikeForwardFrame("s", "batch_design", "t1", { operations: "a" })).toBe(true);
    spikeForwardFrame("s", "batch_design", "t1", { operations: "ab" });
    spikeForwardFrame("s", "batch_design", "t1", { operations: "abc", name: "n" });
    const result = await getSpikeChatSide()!.call("batch_design", "t1", { operations: "abc!" });
    expect(result).toBe("done");
    expect(execute).toHaveBeenCalledWith("batch_design", { operations: "abc!" });
    expect(frames.map((f) => f.input)).toEqual([{ operations: "a" }, { operations: "ab" }, { operations: "abc", name: "n" }]);
    expect(frames.every((f) => f.toolCallId === "t1")).toBe(true);
    const kinds = lb.log.map((l) => l.env.msg.kind);
    expect(kinds).toEqual(["stream", "stream", "stream", "stream-end", "call", "result"]);
    // A late frame after completion does not reopen the stream.
    spikeForwardFrame("s", "batch_design", "t1", { operations: "abc!!" });
    expect(lb.log).toHaveLength(6);

    const stats = canvas.api.stats();
    expect(stats.received.stream?.count).toBe(3);
    expect(stats.received.stream?.latencyMs.max).toBeGreaterThanOrEqual(0);
    expect(stats.seq).toEqual({ gaps: 0, outOfOrder: 0 });
    expect(chat.api.stats().sent.stream?.count).toBe(3);
  });

  it("resyncs after a lost append and keeps the canvas input exact", async () => {
    const { lb, frames, chat, canvas } = setup();
    canvas.api.setRole("canvas");
    chat.api.setRole("chat");
    spikeForwardFrame("s", "batch_design", "t1", { operations: "a" });
    await tick();
    // Lose the second message by muting the canvas for one post.
    lb.muteCanvas = true;
    spikeForwardFrame("s", "batch_design", "t1", { operations: "ab" });
    lb.muteCanvas = false;
    spikeForwardFrame("s", "batch_design", "t1", { operations: "abc" });
    await tick();
    await tick();
    expect(lb.log.some((l) => l.env.msg.kind === "resync")).toBe(true);
    spikeForwardFrame("s", "batch_design", "t1", { operations: "abcd" });
    spikeForwardFrame("s", "batch_design", "t1", { operations: "abcde" });
    await tick();
    expect(frames.at(-1)?.input).toEqual({ operations: "abcde" });
    expect(canvas.api.stats().resyncs.sent).toBe(1);
    expect(chat.api.stats().resyncs.received).toBe(1);
    expect(canvas.api.stats().seq.gaps).toBeGreaterThan(0);
  });

  it("abandoning a stream rolls it back on the canvas side", async () => {
    const { abandoned, chat, canvas } = setup();
    canvas.api.setRole("canvas");
    chat.api.setRole("chat");
    spikeForwardFrame("s", "batch_design", "t9", { operations: "a" });
    getSpikeChatSide()!.endStream("t9", "abandoned");
    await tick();
    expect(abandoned).toEqual(["t9"]);
  });

  it("fails pending calls with a JSON error on peer-gone", async () => {
    const { lb, chat, canvas } = setup({ execute: () => new Promise(() => {}) });
    canvas.api.setRole("canvas");
    chat.api.setRole("chat");
    const pending = getSpikeChatSide()!.call("batch_design", "t1", {});
    await tick();
    lb.killCanvas();
    expect(JSON.parse(await pending)).toEqual({ error: expect.stringContaining("canvas") });
    expect(chat.api.stats().peerGone).toBe(1);
  });

  it("fails a call at once when main reports no canvas tab", async () => {
    const { chat } = setup();
    chat.api.setRole("chat");
    const out = JSON.parse(await getSpikeChatSide()!.call("batch_design", "t1", {}));
    expect(out.error).toBe("no canvas tab");
  });

  it("fails a call that gets no answer after the tool timeout", async () => {
    const { chat, canvas } = setup({ execute: () => new Promise(() => {}) });
    canvas.api.setRole("canvas");
    chat.api.setRole("chat");
    const out = JSON.parse(await getSpikeChatSide()!.call("batch_design", "t1", {}));
    expect(out.error).toMatch(/timed out/);
  });

  it("an aborted signal resolves the call with an error", async () => {
    const { chat, canvas } = setup({ execute: () => new Promise(() => {}) });
    canvas.api.setRole("canvas");
    chat.api.setRole("chat");
    const ctl = new AbortController();
    const pending = getSpikeChatSide()!.call("batch_design", "t1", {}, { signal: ctl.signal });
    ctl.abort();
    expect(JSON.parse(await pending)).toEqual({ error: "aborted" });
  });
});

describe("canvasContext round trip", () => {
  it("replaces the local canvasContext with the canvas tab's and records the round trip", async () => {
    const { chat, canvas } = setup({ context: () => '{"roots":["remote"]}' });
    canvas.api.setRole("canvas");
    chat.api.setRole("chat");
    const body = await spikeRequestBody({ canvasContext: '{"roots":[]}', model: "m" });
    expect(body).toEqual({ canvasContext: '{"roots":["remote"]}', model: "m" });
    await spikeRequestBody({ canvasContext: "x" });
    const stats = chat.api.stats();
    expect(stats.context.roundTripMs.count).toBe(2);
    expect(stats.context.fallbacks).toBe(0);
    const cs = canvas.api.stats();
    expect(cs.context.answered).toBe(2);
    expect(cs.contextStable).toBe(true);
  });

  it("falls back to the local value and counts it when the canvas tab stays silent", async () => {
    const { lb, chat, canvas } = setup();
    canvas.api.setRole("canvas");
    chat.api.setRole("chat");
    lb.muteCanvas = true;
    const local = { canvasContext: "local" };
    expect(await spikeRequestBody(local)).toBe(local);
    expect(chat.api.stats().context.fallbacks).toBe(1);
  });

  it("falls back at once when there is no canvas tab", async () => {
    const { chat } = setup();
    chat.api.setRole("chat");
    const local = { canvasContext: "local" };
    expect(await spikeRequestBody(local)).toBe(local);
    expect(chat.api.stats().context.fallbacks).toBe(1);
  });
});

describe("SpikeStatsCollector", () => {
  const env = (id: string, msg: object, sentAt = 100, relayedAt = 110) =>
    ({ id, sentAt, relayedAt, msg }) as never;

  it("counts seq gaps and out-of-order frames per call", () => {
    const s = new SpikeStatsCollector();
    const frame = (seq: number) => env(`e${seq}`, { kind: "stream", toolCallId: "t", toolName: "x", seq, format: "full", input: {} });
    for (const seq of [0, 1, 3, 2, 4]) s.recordReceived(frame(seq), 120);
    expect(s.snapshot().seq).toEqual({ gaps: 1, outOfOrder: 1 });
    expect(s.snapshot().received.stream?.mainHopMs.max).toBe(10);
    expect(s.snapshot().received.stream?.latencyMs.p50).toBe(20);
  });

  it("flags unstable context for the same scene version", () => {
    const s = new SpikeStatsCollector();
    s.recordContextAnswer("v1", "a");
    expect(s.snapshot().contextStable).toBeNull();
    s.recordContextAnswer("v1", "a");
    expect(s.snapshot().contextStable).toBe(true);
    s.recordContextAnswer("v1", "b");
    expect(s.snapshot().contextStable).toBe(false);
    s.recordContextAnswer("v2", "c");
    expect(s.snapshot().contextStable).toBe(false);
  });
});
