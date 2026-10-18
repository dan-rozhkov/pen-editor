// SPIKE(ipc-streaming): the canvas tab. Feeds forwarded partial inputs into
// the same streaming adapters a local stream uses, runs completed calls, and
// answers canvasContext requests.
import { AppendDecoder } from "./appendCodec";
import type { SpikeStatsCollector } from "./stats";
import {
  errorResult,
  SPIKE_REMOTE_SESSION,
  spikeNow,
  type SpikeDelivered,
  type SpikeMsg,
  type SurfaceSpikeBridge,
} from "./types";
import type { StreamingToolAdapter } from "@/lib/streamingTools/types";

export interface CanvasSideDeps {
  bridge: SurfaceSpikeBridge;
  stats: SpikeStatsCollector;
  getAdapter(toolName: string): StreamingToolAdapter | undefined;
  executeToolCall(
    toolName: string,
    input: unknown,
    context: { sessionId: string; toolCallId: string }
  ): Promise<string>;
  /** The exact string buildCanvasContext() puts in `canvasContext`. */
  buildCanvasContext(): string;
  /** Identity token of the scene state a context is built from (for the stability stat). */
  contextVersion(): unknown;
}

export class CanvasSide {
  private decoders = new Map<string, { toolName: string; decoder: AppendDecoder }>();
  private counter = 0;

  private readonly deps: CanvasSideDeps;

  constructor(deps: CanvasSideDeps) {
    this.deps = deps;
  }

  private post(msg: SpikeMsg): void {
    const env = { id: `v${++this.counter}-${Math.random().toString(36).slice(2, 8)}`, sentAt: spikeNow(), msg };
    this.deps.stats.recordSent(env);
    this.deps.bridge.post(env);
  }

  handle(env: SpikeDelivered): void {
    const { stats } = this.deps;
    stats.recordReceived(env, spikeNow());
    const { msg } = env;
    switch (msg.kind) {
      case "stream": {
        const adapter = this.deps.getAdapter(msg.toolName);
        let entry = this.decoders.get(msg.toolCallId);
        if (!entry) {
          entry = { toolName: msg.toolName, decoder: new AppendDecoder() };
          this.decoders.set(msg.toolCallId, entry);
        }
        const result = entry.decoder.apply(msg);
        if (result.status === "resync") {
          this.post({ kind: "resync", toolCallId: msg.toolCallId });
        } else if (result.status === "ignored") {
          stats.recordIgnoredFrame();
        } else {
          adapter?.onFrame({
            sessionId: SPIKE_REMOTE_SESSION,
            toolCallId: msg.toolCallId,
            input: result.input,
          });
        }
        break;
      }
      case "stream-end": {
        const entry = this.decoders.get(msg.toolCallId);
        this.decoders.delete(msg.toolCallId);
        // "complete": the call that follows owns the commit, exactly like a
        // local stream whose handler takes over. Only abandoned rolls back.
        if (entry && msg.reason === "abandoned") this.abandon(msg.toolCallId, entry.toolName);
        break;
      }
      case "call":
        void this.runCall(msg.callId, msg.toolName, msg.input);
        break;
      case "context-request":
        this.answerContext(msg.reqId);
        break;
      case "peer-gone":
        this.abandonAll();
        break;
      default:
        break;
    }
  }

  private abandon(toolCallId: string, toolName: string): void {
    this.deps.getAdapter(toolName)?.onAbandon({ sessionId: SPIKE_REMOTE_SESSION, toolCallId });
  }

  /** Rolls back every half-streamed call (the chat tab vanished). */
  abandonAll(): void {
    for (const [toolCallId, { toolName }] of this.decoders) this.abandon(toolCallId, toolName);
    this.decoders.clear();
  }

  private async runCall(callId: string, toolName: string, input: unknown): Promise<void> {
    // The streamed state of this call is handed over to the handler.
    this.decoders.delete(callId);
    let result: string;
    try {
      result = await this.deps.executeToolCall(toolName, input, {
        sessionId: SPIKE_REMOTE_SESSION,
        toolCallId: callId,
      });
    } catch (err) {
      result = errorResult(err instanceof Error ? err.message : "Tool call failed");
    }
    this.post({ kind: "result", callId, result });
  }

  private answerContext(reqId: string): void {
    const canvasContext = this.deps.buildCanvasContext();
    this.deps.stats.recordContextAnswer(this.deps.contextVersion(), canvasContext);
    this.post({ kind: "context-response", reqId, canvasContext });
  }
}
