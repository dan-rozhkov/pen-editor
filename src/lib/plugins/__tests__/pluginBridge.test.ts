import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { isRpcRequest, isPluginReadyMessage, handlePluginMessage } from "../pluginBridge";
import type { PluginRpcResponse } from "../types";

vi.mock("sonner", () => ({ toast: vi.fn() }));

function req(method: string, args: unknown[] = [], callId = 1) {
  return { kind: "pen-rpc-request", callId, method, args };
}

describe("isRpcRequest", () => {
  it("accepts a well-formed request and rejects malformed data", () => {
    expect(isRpcRequest(req("selection.get"))).toBe(true);
    expect(isRpcRequest(null)).toBe(false);
    expect(isRpcRequest({ kind: "pen-rpc-request" })).toBe(false);
    expect(isRpcRequest({ kind: "other", callId: 1, method: "x", args: [] })).toBe(false);
    expect(isRpcRequest({ kind: "pen-rpc-request", callId: "1", method: "x", args: [] })).toBe(false);
    expect(isRpcRequest({ kind: "pen-rpc-request", callId: 1, method: "x", args: "no" })).toBe(false);
  });
});

describe("isPluginReadyMessage", () => {
  it("accepts the readiness handshake and rejects everything else", () => {
    expect(isPluginReadyMessage({ kind: "pen-plugin-ready" })).toBe(true);
    expect(isPluginReadyMessage(null)).toBe(false);
    expect(isPluginReadyMessage("pen-plugin-ready")).toBe(false);
    expect(isPluginReadyMessage({ kind: "pen-rpc-request" })).toBe(false);
    expect(isPluginReadyMessage(req("selection.get"))).toBe(false);
  });
});

describe("handlePluginMessage", () => {
  let replies: PluginRpcResponse[];
  const reply = (r: PluginRpcResponse) => replies.push(r);

  beforeEach(() => {
    resetStores();
    seedScene();
    replies = [];
  });

  it("replies ok:true with the facade result", async () => {
    await handlePluginMessage("p1", req("selection.get", [], 7), reply, vi.fn());
    expect(replies).toEqual([
      { kind: "pen-rpc-response", callId: 7, ok: true, result: [] },
    ]);
  });

  it("replies ok:false when the facade throws", async () => {
    await handlePluginMessage("p1", req("tools.run", ["leave_comment", {}], 3), reply, vi.fn());
    expect(replies[0].ok).toBe(false);
    expect(replies[0].error).toMatch(/not allowed/);
  });

  it("silently ignores non-request data", async () => {
    await handlePluginMessage("p1", { hello: 1 }, reply, vi.fn());
    await handlePluginMessage("p1", "str", reply, vi.fn());
    expect(replies).toEqual([]);
  });

  it("routes close to onClose without replying", async () => {
    const onClose = vi.fn();
    await handlePluginMessage("p1", req("close"), reply, onClose);
    expect(onClose).toHaveBeenCalledOnce();
    expect(replies).toEqual([]);
  });
});
