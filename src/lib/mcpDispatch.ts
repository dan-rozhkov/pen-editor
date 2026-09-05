import { executeToolCall } from "@/hooks/useDesignChat";
import { toolHandlers } from "@/lib/toolRegistry";

export interface ToolCallMessage {
  id: string;
  type: "tool_call";
  tool: string;
  args: unknown;
}

export function isToolCallMessage(value: unknown): value is ToolCallMessage {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "tool_call" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { tool?: unknown }).tool === "string"
  );
}

export type ToolDispatchOutcome =
  | { id: string; type: "tool_result"; result: string }
  | { id: string; type: "tool_error"; error: string };

export interface ToolDispatcherOptions {
  send: (message: ToolDispatchOutcome) => void;
  /**
   * Liveness check consulted immediately before *executing* a queued call —
   * not only before sending its outcome. A call queued behind an in-flight
   * one can sit for an arbitrary time; if the transport died in the
   * meantime, the call must be skipped entirely rather than executed (and
   * its scene-mutating side effects committed) with the result silently
   * dropped by `send`. Defaults to always-live, matching the previous
   * behavior for callers that have no notion of transport liveness.
   *
   * Receives the queued message so a caller can pin liveness to whatever was
   * true when *that specific call* arrived, rather than to whatever is true
   * right now. mcpBridge.ts needs this: a call queued on socket A must stay
   * dead even after socket A drops and a reconnect brings up socket B —
   * `() => boolean` alone can only see "is some socket open right now",
   * which a reconnect satisfies for every call still sitting in the queue,
   * not just ones that arrived on the new socket.
   */
  isLive?: (message: ToolCallMessage) => boolean;
}

export interface ToolDispatcher {
  /**
   * Enqueue a tool call. Calls on this transport are serialized: a second
   * call queued while an earlier one is still in flight will not start
   * executing until the first has sent its outcome. Serialization *across*
   * surfaces (chat, the other bridge, WebMCP, plugins) is handled below this
   * layer, by `runToolCall` in toolCallQueue.ts.
   */
  dispatch: (message: ToolCallMessage) => void;
}

/**
 * Transport-agnostic dispatch core shared by every bridge that routes
 * `tool_call` messages into `toolHandlers`/`executeToolCall` (the WebSocket
 * bridge in mcpBridge.ts and the desktop IPC bridge in desktopMcpBridge.ts).
 * Owns: the serial queue, the `isLive` re-check immediately before executing
 * a queued call, and the unknown-tool -> `tool_error` branch.
 * `executeToolCall` itself already never rejects — a throwing handler
 * resolves to a JSON `{"error": "..."}` string — so that contract flows
 * through unchanged; this module does not need to (and must not) wrap
 * dispatch in its own try/catch.
 */
export function createToolDispatcher({ send, isLive = () => true }: ToolDispatcherOptions): ToolDispatcher {
  // Per-dispatcher ordering only: it keeps *this* transport's outcomes in the
  // order its calls arrived. Mutual exclusion against other surfaces is not
  // its job — `executeToolCall` runs every mutating call through the shared
  // queue in toolCallQueue.ts.
  let queue: Promise<void> = Promise.resolve();

  async function handle(message: ToolCallMessage): Promise<void> {
    if (!isLive(message)) return;
    // hasOwnProperty, not `in`: `in` walks the prototype chain, so
    // tool: "toString" / "constructor" / "valueOf" would pass this guard
    // and executeToolCall would then invoke Object.prototype's own
    // toString/constructor as if it were a tool handler.
    if (!Object.prototype.hasOwnProperty.call(toolHandlers, message.tool)) {
      send({ id: message.id, type: "tool_error", error: `Unknown tool: ${message.tool}` });
      return;
    }
    const result = await executeToolCall(message.tool, message.args, undefined, "bridge");
    send({ id: message.id, type: "tool_result", result });
  }

  function dispatch(message: ToolCallMessage): void {
    queue = queue.then(() => handle(message));
  }

  return { dispatch };
}
