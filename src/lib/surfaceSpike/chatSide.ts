// SPIKE(ipc-streaming): the chat tab. Forwards canvas-tool streaming and
// calls to the canvas tab, and fetches canvasContext from it.
import { AppendEncoder } from "./appendCodec";
import type { SpikeStatsCollector } from "./stats";
import {
  errorResult,
  spikeNow,
  type SpikeDelivered,
  type SpikeFormat,
  type SpikeMsg,
  type SurfaceSpikeBridge,
} from "./types";

export const CONTEXT_TIMEOUT_MS = 2000;
/** Added to the per-tool timeout so the canvas side's own timeout error wins the race. */
const CALL_TIMEOUT_MARGIN_MS = 2000;

export interface ChatSideDeps {
  bridge: SurfaceSpikeBridge;
  stats: SpikeStatsCollector;
  getFormat(): SpikeFormat;
  /** The existing per-tool timeout (getToolCallTimeoutMs). */
  toolTimeoutMs(toolName: string): number;
  contextTimeoutMs?: number;
  callTimeoutMarginMs?: number;
}

interface OpenStream {
  sessionId: string;
  encoder: AppendEncoder;
}

interface PendingCall {
  envId: string | null;
  settle(result: string): void;
}

export class ChatSide {
  private streams = new Map<string, OpenStream>();
  /** Calls whose stream is closed: a late frame for one must not reopen it. */
  private ended = new Set<string>();
  private calls = new Map<string, PendingCall>();
  private contexts = new Map<string, (canvasContext: string | null) => void>();
  private envToCall = new Map<string, string>();
  private envToContext = new Map<string, string>();
  private counter = 0;

  private readonly deps: ChatSideDeps;

  constructor(deps: ChatSideDeps) {
    this.deps = deps;
  }

  private post(msg: SpikeMsg): string {
    const env = { id: `c${++this.counter}-${Math.random().toString(36).slice(2, 8)}`, sentAt: spikeNow(), msg };
    this.deps.stats.recordSent(env);
    this.deps.bridge.post(env);
    return env.id;
  }

  /** Forward one partial input. Never throws. */
  forwardFrame(sessionId: string, toolName: string, toolCallId: string, input: Record<string, unknown>): void {
    if (this.ended.has(toolCallId)) return;
    let stream = this.streams.get(toolCallId);
    if (!stream) {
      stream = { sessionId, encoder: new AppendEncoder(toolCallId, toolName) };
      this.streams.set(toolCallId, stream);
    }
    const msg = stream.encoder.encode(input, this.deps.getFormat());
    if (msg) this.post(msg);
  }

  /** Closes a stream if it is open. Idempotent. */
  endStream(toolCallId: string, reason: "complete" | "abandoned"): void {
    this.ended.add(toolCallId);
    if (!this.streams.delete(toolCallId)) return;
    this.post({ kind: "stream-end", toolCallId, reason });
  }

  /** Forward a completed call; resolves with the canvas tab's result string, never rejects. */
  call(
    toolName: string,
    toolCallId: string,
    input: unknown,
    opts: { signal?: AbortSignal } = {}
  ): Promise<string> {
    this.endStream(toolCallId, "complete");
    return new Promise<string>((resolve) => {
      const pending: PendingCall = {
        envId: null,
        settle: (result) => {
          if (!this.calls.delete(toolCallId)) return;
          clearTimeout(timer);
          opts.signal?.removeEventListener("abort", onAbort);
          if (pending.envId) this.envToCall.delete(pending.envId);
          resolve(result);
        },
      };
      const onAbort = () => pending.settle(errorResult("aborted"));
      this.calls.set(toolCallId, pending);
      const timer = setTimeout(
        () => pending.settle(errorResult(`Tool ${toolName} timed out waiting for the canvas tab`)),
        this.deps.toolTimeoutMs(toolName) + (this.deps.callTimeoutMarginMs ?? CALL_TIMEOUT_MARGIN_MS)
      );

      if (opts.signal?.aborted) return onAbort();
      opts.signal?.addEventListener("abort", onAbort);
      pending.envId = this.post({ kind: "call", callId: toolCallId, toolName, input });
      this.envToCall.set(pending.envId, toolCallId);
    });
  }

  /** canvasContext string from the canvas tab, or null on timeout/error/peer-gone. */
  requestContext(): Promise<string | null> {
    const { stats } = this.deps;
    stats.recordContextRequest();
    return new Promise((resolve) => {
      const startedAt = spikeNow();
      let reqId = "";
      const timer = setTimeout(() => finish(null), this.deps.contextTimeoutMs ?? CONTEXT_TIMEOUT_MS);
      const finish = (value: string | null) => {
        if (!this.contexts.delete(reqId)) return;
        clearTimeout(timer);
        if (value === null) stats.recordContextFallback();
        else stats.recordContextRoundTrip(spikeNow() - startedAt);
        resolve(value);
      };
      reqId = `ctx${++this.counter}-${Math.random().toString(36).slice(2, 8)}`;
      this.contexts.set(reqId, finish);
      const envId = this.post({ kind: "context-request", reqId });
      this.envToContext.set(envId, reqId);
    });
  }

  /** Messages from the canvas tab / main. */
  handle(env: SpikeDelivered): void {
    this.deps.stats.recordReceived(env, spikeNow());
    const { msg } = env;
    switch (msg.kind) {
      case "result":
        this.calls.get(msg.callId)?.settle(msg.result);
        break;
      case "context-response":
        this.contexts.get(msg.reqId)?.(msg.canvasContext);
        break;
      case "resync":
        this.streams.get(msg.toolCallId)?.encoder.forceFull();
        break;
      case "error": {
        const callId = this.envToCall.get(msg.refId);
        if (callId) this.calls.get(callId)?.settle(errorResult(msg.error));
        const reqId = this.envToContext.get(msg.refId);
        if (reqId) this.contexts.get(reqId)?.(null);
        break;
      }
      case "peer-gone":
        this.failEverything(`canvas tab is gone (${msg.role})`);
        break;
      default:
        break;
    }
  }

  /** Fails every pending call and context request; forgets open streams. */
  failEverything(reason: string): void {
    this.streams.clear();
    for (const pending of [...this.calls.values()]) pending.settle(errorResult(reason));
    for (const finish of [...this.contexts.values()]) finish(null);
  }

  /** Wraps the local request body with the canvas tab's canvasContext when it answers in time. */
  async withRemoteContext<T extends object>(local: T): Promise<T> {
    const remote = await this.requestContext();
    return remote === null ? local : { ...local, canvasContext: remote };
  }
}
