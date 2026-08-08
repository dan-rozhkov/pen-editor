import { describe, it, expect, vi } from "vitest";
import { createToolDispatcher, isToolCallMessage, type ToolDispatchOutcome } from "@/lib/mcpDispatch";
import { toolHandlers } from "@/lib/toolRegistry";

function makeRecorder() {
  const sent: ToolDispatchOutcome[] = [];
  return { sent, send: (message: ToolDispatchOutcome) => sent.push(message) };
}

describe("isToolCallMessage", () => {
  it("accepts a well-formed tool_call message", () => {
    expect(isToolCallMessage({ id: "1", type: "tool_call", tool: "get_variables", args: {} })).toBe(true);
  });

  it("rejects non-objects and messages missing required fields", () => {
    expect(isToolCallMessage(null)).toBe(false);
    expect(isToolCallMessage("tool_call")).toBe(false);
    expect(isToolCallMessage({ type: "tool_call" })).toBe(false);
    expect(isToolCallMessage({ id: "1", tool: "x" })).toBe(false);
    expect(isToolCallMessage({ id: "1", type: "tool_result", tool: "x" })).toBe(false);
  });
});

describe("createToolDispatcher", () => {
  it("replies tool_error for an unknown tool name without calling any handler", async () => {
    const { sent, send } = makeRecorder();
    const dispatcher = createToolDispatcher({ send });

    dispatcher.dispatch({ id: "call-1", type: "tool_call", tool: "not_a_real_tool", args: {} });

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      id: "call-1",
      type: "tool_error",
      error: "Unknown tool: not_a_real_tool",
    });
  });

  it("dispatches a known tool through toolHandlers and replies tool_result", async () => {
    const originalHandler = toolHandlers.get_variables;
    toolHandlers.get_variables = vi.fn(async () => '{"variables":[]}');

    const { sent, send } = makeRecorder();
    const dispatcher = createToolDispatcher({ send });
    dispatcher.dispatch({ id: "call-1", type: "tool_call", tool: "get_variables", args: {} });

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ id: "call-1", type: "tool_result", result: '{"variables":[]}' });

    toolHandlers.get_variables = originalHandler;
  });

  it("serializes concurrent calls so the second does not start before the first resolves", async () => {
    const originalVariables = toolHandlers.get_variables;
    const originalStyles = toolHandlers.get_styles;

    let resolveFirst: (() => void) | undefined;
    const order: string[] = [];
    toolHandlers.get_variables = vi.fn(async () => {
      order.push("start-1");
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      order.push("end-1");
      return "1";
    });
    toolHandlers.get_styles = vi.fn(async () => {
      order.push("start-2");
      return "2";
    });

    const { sent, send } = makeRecorder();
    const dispatcher = createToolDispatcher({ send });

    dispatcher.dispatch({ id: "call-1", type: "tool_call", tool: "get_variables", args: {} });
    dispatcher.dispatch({ id: "call-2", type: "tool_call", tool: "get_styles", args: {} });

    await vi.waitFor(() => expect(order).toEqual(["start-1"]));
    // The second call must not have started while the first is in flight.
    expect(order).not.toContain("start-2");

    resolveFirst?.();
    await vi.waitFor(() => expect(order).toEqual(["start-1", "end-1", "start-2"]));
    await vi.waitFor(() => expect(sent).toHaveLength(2));

    toolHandlers.get_variables = originalVariables;
    toolHandlers.get_styles = originalStyles;
  });

  // Regression for finding 5: `message.tool in toolHandlers` walks the
  // prototype chain, so a caller sending tool: "toString" or "constructor"
  // used to find a truthy non-handler on Object.prototype and get past this
  // guard entirely — executeToolCall would then invoke it as if it were a
  // real tool handler instead of hitting the "Unknown tool" branch.
  it("replies tool_error for tool names that exist only on the prototype chain (toString, constructor)", async () => {
    const { sent, send } = makeRecorder();
    const dispatcher = createToolDispatcher({ send });

    dispatcher.dispatch({ id: "call-1", type: "tool_call", tool: "toString", args: {} });
    dispatcher.dispatch({ id: "call-2", type: "tool_call", tool: "constructor", args: {} });

    await vi.waitFor(() => expect(sent).toHaveLength(2));

    expect(sent[0]).toEqual({ id: "call-1", type: "tool_error", error: "Unknown tool: toString" });
    expect(sent[1]).toEqual({ id: "call-2", type: "tool_error", error: "Unknown tool: constructor" });
  });

  it("a handler that throws surfaces as a resolved tool_result with an error string, not a rejection, and does not block the queue", async () => {
    const originalHandler = toolHandlers.get_variables;
    toolHandlers.get_variables = vi.fn(async () => {
      throw new Error("boom");
    });
    const originalStyles = toolHandlers.get_styles;
    toolHandlers.get_styles = vi.fn(async () => "after-error");

    const { sent, send } = makeRecorder();
    const dispatcher = createToolDispatcher({ send });

    // dispatch() itself must not throw and must not return a rejected
    // promise — it is fire-and-forget by design.
    expect(() => {
      dispatcher.dispatch({ id: "call-1", type: "tool_call", tool: "get_variables", args: {} });
      dispatcher.dispatch({ id: "call-2", type: "tool_call", tool: "get_styles", args: {} });
    }).not.toThrow();

    await vi.waitFor(() => expect(sent).toHaveLength(2));

    expect(sent[0].type).toBe("tool_result");
    expect(JSON.parse((sent[0] as { result: string }).result)).toEqual({ error: "boom" });

    // The second call, queued behind the throwing one, still ran.
    expect(sent[1]).toEqual({ id: "call-2", type: "tool_result", result: "after-error" });

    toolHandlers.get_variables = originalHandler;
    toolHandlers.get_styles = originalStyles;
  });
});
