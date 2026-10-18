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
import { canMutateScene } from "@/lib/webmcp/registerTools";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { computeSelectionItems } from "@/hooks/useSelectionContext";
import { computeEmbedElementContext } from "@/hooks/useEmbedElementContext";
import { useSharedViewStore } from "@/store/sharedViewStore";
import { generateId } from "@/types/scene";
import { FALLBACK_SIZE, isPositive, placeNodeOnCanvas } from "@/lib/tools/browser/placeOnCanvas";
import type { SceneNode } from "@/types/scene";
import { AppendDecoder } from "./appendCodec";
import {
  linkNow,
  type CanvasHostBridge,
  type CanvasToChatMsg,
  type ChatLaunchMessagePayload,
  type ChatToCanvasMsg,
  type LinkEnvelope,
  type MainToCanvasMsg,
  type SelectionChipsSnapshot,
} from "./protocol";
import { buildSceneContext } from "./sceneContext";
import { clearCanvasHostLaunchPoster, nextLaunchId, resolveLaunchAck, setCanvasHostLaunchPoster } from "./agentLaunch";

/** Session id every canvas-link tool call and stream runs under. */
export const CANVAS_LINK_SESSION = "canvas-link";

const errorResult = (message: string): string => JSON.stringify({ error: message });
const NOT_EDITABLE_MESSAGE =
  "This canvas is not editable right now (read-only view or present mode); editing tools are unavailable.";

/** What the composer's selection chips show for this tab right now (same logic as the chip hooks). */
function buildSelectionSnapshot(): SelectionChipsSnapshot {
  const { nodesById } = useSceneStore.getState();
  const picked = useEmbedPickerStore.getState().selection;
  const embed = computeEmbedElementContext(picked, picked ? nodesById[picked.embedId] : undefined);
  return {
    nodes: computeSelectionItems(useSelectionStore.getState().selectedIds, nodesById),
    embedElement: embed && { label: embed.label, embedName: embed.embedName, textPreview: embed.selection.textPreview },
  };
}

function sameSelection(a: SelectionChipsSnapshot, b: SelectionChipsSnapshot): boolean {
  if (a.nodes.length !== b.nodes.length) return false;
  for (let i = 0; i < a.nodes.length; i++) {
    const x = a.nodes[i];
    const y = b.nodes[i];
    if (x.nodeId !== y.nodeId || x.name !== y.name || x.type !== y.type) return false;
  }
  const x = a.embedElement;
  const y = b.embedElement;
  if (!x || !y) return x === y;
  return x.label === y.label && x.embedName === y.embedName && x.textPreview === y.textPreview;
}

/** One editability rule for WebMCP and the host: `canMutateScene` (lib/webmcp/registerTools.ts). */
const isCanvasEditable = canMutateScene;

interface StreamEntry {
  toolName: string;
  /** Null after `stream-end "complete"`: kept only until the matching `call` or an `"abandoned"`. */
  decoder: AppendDecoder | null;
}

interface CallEntry {
  controller: AbortController;
  /** `panel-gone`: the asker no longer exists, so nothing is posted for this call. */
  silent: boolean;
}

export function startCanvasHost(bridge: CanvasHostBridge): () => void {
  const streams = new Map<string, StreamEntry>();
  const calls = new Map<string, CallEntry>();
  let counter = 0;
  let stopped = false;

  /** true = handed to the bridge; false = not sent (stopped, or the bridge threw). */
  const post = (msg: CanvasToChatMsg): boolean => {
    if (stopped) return false;
    try {
      const env: LinkEnvelope<CanvasToChatMsg> = {
        id: `c${++counter}-${Math.random().toString(36).slice(2, 8)}`,
        sentAt: linkNow(),
        msg,
      };
      bridge.post(env);
      return true;
    } catch (err) {
      console.warn("[canvasHost] post failed", err);
      return false;
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
   * Runs `work` as call `callId`: exactly one `result` is posted (none after
   * `panel-gone`). The timeout is NOT handled here: `executeToolCall` owns it and
   * starts it inside the serial queue. A callId that is still running is ignored
   * (the first call keeps running and answers once). `work` calls `started()`
   * when its handler really begins; `onEnd(started)` runs once the call is over.
   */
  const runCall = (
    callId: string,
    work: (signal: AbortSignal, started: () => void) => Promise<string>,
    onEnd?: (started: boolean) => void
  ): void => {
    if (calls.has(callId)) return;
    const entry: CallEntry = { controller: new AbortController(), silent: false };
    calls.set(callId, entry);
    let didStart = false;
    const started = (): void => {
      if (didStart) return;
      didStart = true;
      if (!entry.silent) post({ kind: "started", callId });
    };
    const settle = (result: string): void => {
      if (calls.get(callId) === entry) calls.delete(callId);
      try {
        onEnd?.(didStart);
      } catch (err) {
        console.warn("[canvasHost] call cleanup failed", err);
      }
      if (!entry.silent) post({ kind: "result", callId, result });
    };
    let promise: Promise<string>;
    try {
      promise = work(entry.controller.signal, started);
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

  const handle = (msg: ChatToCanvasMsg | MainToCanvasMsg): void => {
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
      case "call": {
        // The streamed state stays registered until the handler really starts, then
        // is handed over under the same id (callId === toolCallId), like the local
        // path. A call that ends without running (aborted while queued, refused,
        // unknown tool) rolls the stream back.
        runCall(
          msg.callId,
          async (signal, started) => {
            if (toolHandlers[msg.toolName] && isSerializedTool(msg.toolName) && !isCanvasEditable()) {
              return errorResult(NOT_EDITABLE_MESSAGE);
            }
            // The budget counts from the start of the queued task (executeToolCall).
            return executeToolCall(
              msg.toolName,
              msg.input,
              {
                sessionId: CANVAS_LINK_SESSION,
                toolCallId: msg.callId,
                signal,
                onStart: () => {
                  streams.delete(msg.callId);
                  started();
                },
              },
              "canvas-link",
              { timeoutMs: msg.timeoutMs }
            );
          },
          () => {
            const left = streams.get(msg.callId);
            if (!left) return;
            streams.delete(msg.callId);
            abandon(msg.callId, left.toolName);
          }
        );
        break;
      }
      case "cancel":
        // The handler still answers (with an error); the panel ignores it.
        calls.get(msg.callId)?.controller.abort();
        break;
      case "place-node":
        handlePlaceNode(msg);
        break;
      case "panel-gone":
        // The agent panel reloaded or crashed: cancel everything it left behind.
        // Running calls are aborted, queued ones never run (and roll their stream
        // back), open streams are abandoned, and nobody is told.
        for (const entry of calls.values()) {
          entry.silent = true;
          entry.controller.abort();
        }
        calls.clear();
        for (const [toolCallId, { toolName }] of streams) abandon(toolCallId, toolName);
        streams.clear();
        break;
      case "launch-ack":
        resolveLaunchAck(msg.launchId, msg.error);
        break;
      case "selection-request":
        publishSelection(true);
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

  // Selection chips: posted when the snapshot changes, coalesced into one microtask (a drag or marquee
  // fires many store updates) and deduped by the fields the chips show. `force` re-sends the last one.
  let lastSelection: SelectionChipsSnapshot | null = null;
  let selectionQueued = false;
  const publishSelection = (force = false): void => {
    if (stopped) return;
    const next = buildSelectionSnapshot();
    if (!force && lastSelection && sameSelection(lastSelection, next)) return;
    if (post({ kind: "selection", selection: next })) lastSelection = next;
  };
  const scheduleSelection = (): void => {
    if (selectionQueued || stopped) return;
    selectionQueued = true;
    queueMicrotask(() => {
      selectionQueued = false;
      try {
        publishSelection();
      } catch (err) {
        console.warn("[canvasHost] selection publish failed", err);
      }
    });
  };
  let stopSelectionWatch: (() => void) | null = null;

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

  let registered = false;
  try {
    bridge.register();
    registered = true;
  } catch (err) {
    console.warn("[canvasHost] register failed", err);
  }

  // Entry points (deliverAgentLaunch) post through this host, but only once it IS registered:
  // `canLaunchAgent()` / `isCanvasHostRunning()` must not promise a delivery a failed register cannot make.
  const launchPoster = (payload: ChatLaunchMessagePayload, id?: string): string | null => {
    const launchId = id ?? nextLaunchId();
    return post({ kind: "launch", launchId, payload }) ? launchId : null;
  };
  if (registered) {
    setCanvasHostLaunchPoster(launchPoster);
    const offs = [
      useSelectionStore.subscribe(scheduleSelection),
      // Scene edits matter only when they touch a selected node or the picked embed (name/type).
      useSceneStore.subscribe((state, prev) => {
        if (state.nodesById === prev.nodesById) return;
        const picked = useEmbedPickerStore.getState().selection;
        const touched = (id: string) => state.nodesById[id] !== prev.nodesById[id];
        if (useSelectionStore.getState().selectedIds.some(touched) || (picked && touched(picked.embedId))) {
          scheduleSelection();
        }
      }),
      useEmbedPickerStore.subscribe(scheduleSelection),
    ];
    stopSelectionWatch = () => offs.forEach((off) => off());
    publishSelection(); // a panel that is already open gets the state without waiting for a change
  }

  return () => {
    if (stopped) return;
    unsubscribe();
    stopSelectionWatch?.();
    clearCanvasHostLaunchPoster(launchPoster);
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
    for (const entry of calls.values()) entry.controller.abort();
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
 * App.tsx's one entry: starts the host in a chatless tab that has the desktop
 * `canvasHost` bridge, never on the shared viewer (someone else's document).
 * View/present mode does not matter here: the host stays up across mode
 * toggles (a call must not be stopped mid-run) and refuses mutating work itself
 * while the canvas is not editable. Returns the stop function, or null.
 */
export function maybeStartCanvasHost(): (() => void) | null {
  const bridge = typeof window === "undefined" ? undefined : window.penDesktop?.canvasHost;
  if (!bridge || !isChatDisabled() || useSharedViewStore.getState().isSharedView) return null;
  return startCanvasHost(bridge);
}
