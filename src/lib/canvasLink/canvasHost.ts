/**
 * Canvas link, canvas-tab side (docs/canvas-link.md). A chatless editor tab
 * in the desktop agent layout registers as a canvas host and serves the agent
 * panel: it replays streamed tool input into the same streaming adapters a
 * local chat uses, runs completed tool calls, places browser-tool nodes and
 * answers per-turn scene-context requests. Every message is keyed by an id and
 * every call is answered; a handler never throws out of `startCanvasHost`.
 */
import { isChatDisabled } from "@/lib/chatMode";
import { executeToolCall } from "@/hooks/useDesignChat";
import { getStreamingToolAdapter, streamingToolAdapters } from "@/lib/streamingTools";
import { isSerializedTool } from "@/lib/toolCallQueue";
import { toolHandlers } from "@/lib/toolRegistry";
import { canEditScene, useEditorModeStore } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSharedViewStore } from "@/store/sharedViewStore";
import { generateId } from "@/types/scene";
import { FALLBACK_SIZE, isPositive, placeNodeOnCanvas } from "@/lib/tools/browser/placeOnCanvas";
import type { SceneNode } from "@/types/scene";
import { AppendDecoder } from "./appendCodec";
import {
  linkNow,
  type CanvasHostBridge,
  type CanvasToChatMsg,
  type ChatToCanvasMsg,
  type LinkEnvelope,
} from "./protocol";
import { buildSceneContext } from "./sceneContext";

/** Session id every canvas-link tool call and stream runs under. */
export const CANVAS_LINK_SESSION = "canvas-link";

const errorResult = (message: string): string => JSON.stringify({ error: message });
const NOT_EDITABLE_MESSAGE =
  "This canvas is not editable right now (read-only view or present mode); editing tools are unavailable.";

/**
 * The same rule WebMCP applies (`canMutateScene` in lib/webmcp/registerTools.ts):
 * not the shared `/c/:shareId` viewer, and the editor mode allows scene edits.
 * The host starts only when this holds, and refuses mutating work if it stops.
 */
export function isCanvasEditable(): boolean {
  if (useSharedViewStore.getState().isSharedView) return false;
  return canEditScene(useEditorModeStore.getState().mode);
}

interface StreamEntry {
  toolName: string;
  /** Null after `stream-end "complete"`: kept only until the matching `call` or an `"abandoned"`. */
  decoder: AppendDecoder | null;
}

export function startCanvasHost(bridge: CanvasHostBridge): () => void {
  const streams = new Map<string, StreamEntry>();
  const calls = new Map<string, AbortController>();
  let counter = 0;
  let stopped = false;

  const post = (msg: CanvasToChatMsg): void => {
    if (stopped) return;
    try {
      const env: LinkEnvelope<CanvasToChatMsg> = {
        id: `c${++counter}-${Math.random().toString(36).slice(2, 8)}`,
        sentAt: linkNow(),
        msg,
      };
      bridge.post(env);
    } catch (err) {
      console.warn("[canvasHost] post failed", err);
    }
  };

  const abandon = (toolCallId: string, toolName: string): void => {
    try {
      getStreamingToolAdapter(toolName)?.onAbandon({ sessionId: CANVAS_LINK_SESSION, toolCallId });
    } catch (err) {
      console.warn("[canvasHost] abandon failed", err);
    }
  };

  /**
   * Runs `work` as call `callId`: exactly one `result` is posted. The timeout
   * is NOT handled here: `executeToolCall` owns it and starts it inside the
   * serial queue. A callId that is still running is ignored (the first call
   * keeps running and answers once).
   */
  const runCall = (callId: string, work: (signal: AbortSignal) => Promise<string>): void => {
    if (calls.has(callId)) return;
    const controller = new AbortController();
    calls.set(callId, controller);
    const settle = (result: string): void => {
      if (calls.get(callId) === controller) calls.delete(callId);
      post({ kind: "result", callId, result });
    };
    let promise: Promise<string>;
    try {
      promise = work(controller.signal);
    } catch (err) {
      promise = Promise.reject(err);
    }
    promise.then(settle, (err: unknown) =>
      settle(errorResult(err instanceof Error ? err.message : "Tool call failed"))
    );
  };

  const handleStream = (msg: Extract<ChatToCanvasMsg, { kind: "stream" }>): void => {
    // Streaming adapters mutate the real scene: never on a non-editable canvas.
    if (!isCanvasEditable()) return;
    let entry = streams.get(msg.toolCallId);
    if (!entry) {
      entry = { toolName: msg.toolName, decoder: new AppendDecoder() };
      streams.set(msg.toolCallId, entry);
    }
    // A stream that already completed takes no more frames.
    if (!entry.decoder) return;
    const result = entry.decoder.apply(msg);
    if (result.status === "resync") {
      post({ kind: "resync", toolCallId: msg.toolCallId });
    } else if (result.status === "input") {
      getStreamingToolAdapter(msg.toolName)?.onFrame({
        sessionId: CANVAS_LINK_SESSION,
        toolCallId: msg.toolCallId,
        input: result.input,
      });
    }
  };

  const handlePlaceNode = (msg: Extract<ChatToCanvasMsg, { kind: "place-node" }>): void => {
    runCall(msg.callId, async (signal) => {
      if (!isCanvasEditable()) return errorResult(NOT_EDITABLE_MESSAGE);
      const node = msg.node;
      if (
        typeof node !== "object" ||
        node === null ||
        Array.isArray(node) ||
        typeof (node as { type?: unknown }).type !== "string"
      ) {
        return errorResult("place-node: invalid node");
      }
      const rawId = (node as { id?: unknown }).id;
      const id = typeof rawId === "string" && rawId.length > 0 ? rawId : generateId();
      const opts = (typeof msg.options === "object" && msg.options !== null ? msg.options : {}) as {
        x?: unknown;
        y?: unknown;
        size?: { width?: unknown; height?: unknown };
      };
      const size =
        isPositive(opts.size?.width) && isPositive(opts.size?.height)
          ? { width: opts.size.width, height: opts.size.height }
          : FALLBACK_SIZE;
      const placed = await placeNodeOnCanvas(
        opts.x,
        opts.y,
        size,
        (pos) => {
          // Checked inside the queued task, next to the addNode it protects.
          if (useSceneStore.getState().nodesById[id]) throw new Error("place-node: id already exists");
          return { ...(node as object), id, x: pos.x, y: pos.y } as SceneNode;
        },
        signal
      );
      return placed ? JSON.stringify(placed) : errorResult("place-node: cancelled");
    });
  };

  const handle = (msg: ChatToCanvasMsg): void => {
    switch (msg.kind) {
      case "stream":
        handleStream(msg);
        break;
      case "stream-end": {
        const entry = streams.get(msg.toolCallId);
        if (!entry) break;
        if (msg.reason === "abandoned") {
          // Also after a "complete": the `call` never arrived, so roll back.
          streams.delete(msg.toolCallId);
          abandon(msg.toolCallId, entry.toolName);
        } else {
          // "complete": the `call` that follows commits, like a local stream
          // whose handler takes over. Keep the tool name until then.
          entry.decoder = null;
        }
        break;
      }
      case "call":
        // The streamed state is handed over to the handler under the same id
        // (callId === toolCallId), exactly like the local path.
        streams.delete(msg.callId);
        runCall(msg.callId, async (signal) => {
          if (toolHandlers[msg.toolName] && isSerializedTool(msg.toolName) && !isCanvasEditable()) {
            return errorResult(NOT_EDITABLE_MESSAGE);
          }
          // The budget counts from the start of the queued task (executeToolCall).
          return executeToolCall(
            msg.toolName,
            msg.input,
            { sessionId: CANVAS_LINK_SESSION, toolCallId: msg.callId, signal },
            "canvas-link",
            { timeoutMs: msg.timeoutMs }
          );
        });
        break;
      case "cancel":
        // The handler still answers (with an error); the panel ignores it.
        calls.get(msg.callId)?.abort();
        break;
      case "place-node":
        handlePlaceNode(msg);
        break;
      case "context-request":
        post({
          kind: "context-response",
          reqId: msg.reqId,
          canvasContext: JSON.stringify(buildSceneContext({ model: msg.model })),
        });
        break;
      default:
        break;
    }
  };

  const unsubscribe = bridge.onMessage((env) => {
    if (stopped) return;
    try {
      handle(env.msg);
    } catch (err) {
      console.warn("[canvasHost] handler failed", err);
      const msg = env.msg;
      // Answer whatever is answerable, so the panel never waits for a timeout.
      if (msg.kind === "call" || msg.kind === "place-node") {
        post({ kind: "result", callId: msg.callId, result: errorResult("Canvas host error") });
      } else if (msg.kind === "stream") {
        post({ kind: "resync", toolCallId: msg.toolCallId });
      } else if (msg.kind === "context-request") {
        post({ kind: "context-response", reqId: msg.reqId, canvasContext: "{}" });
      }
    }
  });

  try {
    bridge.register();
  } catch (err) {
    console.warn("[canvasHost] register failed", err);
  }

  return () => {
    if (stopped) return;
    unsubscribe();
    // Roll back half-streamed and completed-but-uncalled streams, drop every
    // adapter's per-session leftovers, abort running calls. Nothing is posted after stop.
    for (const [toolCallId, { toolName }] of streams) abandon(toolCallId, toolName);
    streams.clear();
    for (const adapter of streamingToolAdapters) {
      try {
        adapter.onSessionClear(CANVAS_LINK_SESSION);
      } catch (err) {
        console.warn("[canvasHost] session clear failed", err);
      }
    }
    for (const controller of calls.values()) controller.abort();
    calls.clear();
    stopped = true;
    try {
      bridge.unregister();
    } catch (err) {
      console.warn("[canvasHost] unregister failed", err);
    }
  };
}

/**
 * App.tsx's one entry: starts the host only in a chatless tab that has the
 * desktop `canvasHost` bridge, on an editable canvas (not the shared viewer,
 * not view/present mode). Returns the stop function, or null.
 */
export function maybeStartCanvasHost(): (() => void) | null {
  const bridge = typeof window === "undefined" ? undefined : window.penDesktop?.canvasHost;
  if (!bridge || !isChatDisabled() || !isCanvasEditable()) return null;
  return startCanvasHost(bridge);
}
