import { describe, it, expect } from "vitest";
import {
  UNSERIALIZED_TOOL_NAMES,
  isSerializedTool,
  runToolCall,
} from "@/lib/toolCallQueue";
import { toolHandlers } from "@/lib/toolRegistry";
import { WEBMCP_TOOL_SPECS } from "@/lib/webmcp/schemas";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("isSerializedTool", () => {
  // The default direction is the safety property: wrongly serializing a read
  // costs latency, wrongly parallelizing a write loses work.
  it("serializes any tool not explicitly listed as read-only", () => {
    expect(isSerializedTool("batch_design")).toBe(true);
    expect(isSerializedTool("set_variables")).toBe(true);
    expect(isSerializedTool("a_tool_added_next_week")).toBe(true);
  });

  it("does not serialize the listed read-only tools", () => {
    for (const name of UNSERIALIZED_TOOL_NAMES) {
      expect(isSerializedTool(name), name).toBe(false);
    }
  });

  it("names only tools that actually exist", () => {
    for (const name of UNSERIALIZED_TOOL_NAMES) {
      expect(Object.prototype.hasOwnProperty.call(toolHandlers, name), name).toBe(true);
    }
  });

  // Two independent judgements about the same tools; a disagreement means one
  // of them is wrong about whether the tool writes to the scene.
  it("agrees with the WebMCP specs about which tools mutate", () => {
    for (const spec of WEBMCP_TOOL_SPECS) {
      expect(isSerializedTool(spec.name), spec.name).toBe(spec.mutating);
    }
  });
});

describe("runToolCall", () => {
  it("runs a read-only call immediately, without waiting for the queue", async () => {
    const blocker = deferred<string>();
    const mutating = runToolCall("batch_design", () => blocker.promise);

    await expect(runToolCall("batch_get", async () => "read")).resolves.toBe("read");

    blocker.resolve("write");
    await mutating;
  });

  it("holds a mutating call until the one before it settles", async () => {
    const first = deferred<string>();
    const order: string[] = [];

    const a = runToolCall("batch_design", async () => {
      const value = await first.promise;
      order.push("first");
      return value;
    });
    const b = runToolCall("set_variables", async () => {
      order.push("second");
      return "b";
    });

    // Nothing may have run second while the first is still in flight.
    await Promise.resolve();
    expect(order).toEqual([]);

    first.resolve("a");
    await Promise.all([a, b]);
    expect(order).toEqual(["first", "second"]);
  });

  // A rejected call used to leave the chain rejected, so every later call
  // inherited the failure.
  it("keeps the queue usable after a call rejects", async () => {
    const failing = runToolCall("batch_design", async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");

    await expect(runToolCall("batch_design", async () => "after")).resolves.toBe("after");
  });

  it("propagates the task's own result and error to its caller", async () => {
    await expect(runToolCall("set_variables", async () => ({ ok: 1 }))).resolves.toEqual({ ok: 1 });
    await expect(
      runToolCall("set_variables", async () => {
        throw new Error("specific");
      })
    ).rejects.toThrow("specific");
  });
});
