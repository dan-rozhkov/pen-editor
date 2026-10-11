import { afterEach, describe, expect, it, vi } from "vitest";
import { executeToolCall } from "@/hooks/useDesignChat";
import { toolHandlers } from "@/lib/toolRegistry";

const original = toolHandlers.browse_task;

afterEach(() => {
  toolHandlers.browse_task = original;
  vi.useRealTimers();
});

describe("executeToolCall browse_task cancellation", () => {
  it("forwards the caller's abort to the handler's signal", async () => {
    let seen: AbortSignal | undefined;
    toolHandlers.browse_task = async (_a, ctx) => {
      seen = ctx?.signal;
      return "{}";
    };
    const ac = new AbortController();
    await executeToolCall("browse_task", { goal: "x" }, { signal: ac.signal }, "chat");
    expect(seen?.aborted).toBe(false);
    ac.abort();
    expect(seen?.aborted).toBe(true);
  });

  it("aborts the handler's signal when the tool call times out", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    toolHandlers.browse_task = (_a, ctx) => {
      seen = ctx?.signal;
      return new Promise(() => {});
    };
    const pending = executeToolCall("browse_task", { goal: "x" }, undefined, "chat");
    await vi.advanceTimersByTimeAsync(2_000_000);
    expect(await pending).toContain("error");
    expect(seen?.aborted).toBe(true);
  });
});
