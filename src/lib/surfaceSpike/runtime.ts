// SPIKE(ipc-streaming): window.__spike and the thin hooks useDesignChat calls.
// Every hook is a no-op that returns the "local behavior" answer unless this
// tab's role is "chat" (or "canvas", for the canvas side), so nothing changes
// when no role is set.
import { CanvasSide, type CanvasSideDeps } from "./canvasSide";
import { ChatSide, type ChatSideDeps } from "./chatSide";
import { SpikeStatsCollector, type SpikeStats } from "./stats";
import { isCanvasTool, type SpikeFormat, type SpikeRole, type SurfaceSpikeBridge } from "./types";

export interface SpikeRuntimeDeps {
  bridge: SurfaceSpikeBridge;
  toolTimeoutMs: ChatSideDeps["toolTimeoutMs"];
  getAdapter: CanvasSideDeps["getAdapter"];
  executeToolCall: CanvasSideDeps["executeToolCall"];
  buildCanvasContext: CanvasSideDeps["buildCanvasContext"];
  contextVersion: CanvasSideDeps["contextVersion"];
  contextTimeoutMs?: number;
  callTimeoutMarginMs?: number;
}

export interface SpikeApi {
  setRole(role: SpikeRole | null): void;
  format: SpikeFormat;
  stats(): SpikeStats & { role: SpikeRole | null; format: SpikeFormat };
  reset(): void;
  /** SPIKE(ipc-streaming): bench helper, one context round trip from the chat tab (null = fallback). */
  requestContext(): Promise<string | null>;
}

declare global {
  interface Window {
    __spike?: SpikeApi;
  }
}

let chatSide: ChatSide | null = null;

export function createSpikeRuntime(deps: SpikeRuntimeDeps): { api: SpikeApi; dispose(): void } {
  let role: SpikeRole | null = null;
  let stats = new SpikeStatsCollector();
  let unsubscribe: (() => void) | null = null;
  let canvas: CanvasSide | null = null;
  let mine: ChatSide | null = null;

  const teardown = () => {
    unsubscribe?.();
    unsubscribe = null;
    mine?.failEverything("spike role changed");
    canvas?.abandonAll();
    if (chatSide === mine) chatSide = null;
    mine = null;
    canvas = null;
  };

  const api: SpikeApi = {
    format: "append",
    setRole(next) {
      teardown();
      role = next;
      if (next === "chat") {
        const side = new ChatSide({
          bridge: deps.bridge,
          stats,
          getFormat: () => api.format,
          toolTimeoutMs: deps.toolTimeoutMs,
          contextTimeoutMs: deps.contextTimeoutMs,
          callTimeoutMarginMs: deps.callTimeoutMarginMs,
        });
        chatSide = mine = side;
        unsubscribe = deps.bridge.onMessage((env) => side.handle(env));
      } else if (next === "canvas") {
        const side = new CanvasSide({ ...deps, bridge: deps.bridge, stats });
        canvas = side;
        unsubscribe = deps.bridge.onMessage((env) => side.handle(env));
      }
      deps.bridge.setRole(next);
    },
    requestContext: () => (mine ? mine.requestContext() : Promise.resolve(null)), // SPIKE(ipc-streaming)
    stats: () => ({ ...stats.snapshot(), role, format: api.format }),
    reset() {
      // New collector; the sides keep a reference to the old one, so rebuild them.
      stats = new SpikeStatsCollector();
      const current = role;
      if (current) api.setRole(current);
    },
  };
  return {
    api,
    dispose() {
      teardown();
      role = null;
    },
  };
}

/** Test seam. */
export function getSpikeChatSide(): ChatSide | null {
  return chatSide;
}

// ---- hooks used by useDesignChat ------------------------------------------

/** True when this tab forwards `toolName` to the canvas tab instead of running it. */
export function spikeForwards(toolName: string): boolean {
  return chatSide !== null && isCanvasTool(toolName);
}

/** Forwards a partial input; returns true when it was consumed (do not apply locally). */
export function spikeForwardFrame(
  sessionId: string,
  toolName: string,
  toolCallId: string,
  input: Record<string, unknown>
): boolean {
  if (!chatSide || !isCanvasTool(toolName)) return false;
  chatSide.forwardFrame(sessionId, toolName, toolCallId, input);
  return true;
}

export function spikeEndStream(toolCallId: string, reason: "complete" | "abandoned"): void {
  chatSide?.endStream(toolCallId, reason);
}

export function spikeCall(
  toolName: string,
  toolCallId: string,
  input: unknown,
  signal?: AbortSignal
): Promise<string> {
  return chatSide!.call(toolName, toolCallId, input, { signal });
}

/** Request-body provider wrapper: the sync local body unless this tab is the chat tab. */
export function spikeRequestBody<T extends object>(local: T): T | Promise<T> {
  return chatSide ? chatSide.withRemoteContext(local) : local;
}
