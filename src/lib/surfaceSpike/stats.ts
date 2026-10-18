// SPIKE(ipc-streaming): receiver-side measurements, exposed as plain JSON.
import type { SpikeDelivered, SpikeEnvelope, SpikeKind } from "./types";

const SAMPLE_CAP = 50_000;

export interface Dist {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

function dist(samples: number[]): Dist {
  if (samples.length === 0) return { count: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
}

function push(list: number[], value: number): void {
  if (Number.isFinite(value) && list.length < SAMPLE_CAP) list.push(value);
}

/** FNV-1a 32-bit plus length: enough to tell two strings apart in a spike. */
export function hashString(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}:${text.length}`;
}

interface KindAcc {
  count: number;
  bytes: number;
  latency: number[];
  mainHop: number[];
}

export interface SpikeStats {
  received: Partial<Record<SpikeKind, { count: number; bytes: number; latencyMs: Dist; mainHopMs: Dist }>>;
  sent: Partial<Record<SpikeKind, { count: number; bytes: number }>>;
  seq: { gaps: number; outOfOrder: number };
  resyncs: { sent: number; received: number };
  /** Frames dropped on the canvas side while waiting for a "full" after a resync. */
  ignoredFrames: number;
  errors: number;
  peerGone: number;
  context: {
    requests: number;
    roundTripMs: Dist;
    fallbacks: number;
    /** Answers the canvas side produced, and how many scene versions were seen more than once. */
    answered: number;
    versionsRepeated: number;
  };
  /** null until a scene version was answered twice; false if any repeat differed. */
  contextStable: boolean | null;
}

export class SpikeStatsCollector {
  private received = new Map<SpikeKind, KindAcc>();
  private sent = new Map<SpikeKind, { count: number; bytes: number }>();
  private lastSeq = new Map<string, number>();
  private gaps = 0;
  private outOfOrder = 0;
  private resyncSent = 0;
  private resyncReceived = 0;
  private ignored = 0;
  private errors = 0;
  private peerGone = 0;
  private ctxRequests = 0;
  private ctxRoundTrips: number[] = [];
  private ctxFallbacks = 0;
  private ctxAnswered = 0;
  private versionHashes = new Map<unknown, string>();
  private versionsRepeated = 0;
  private stable: boolean | null = null;

  recordSent(env: SpikeEnvelope): void {
    const acc = this.sent.get(env.msg.kind) ?? { count: 0, bytes: 0 };
    acc.count++;
    acc.bytes += JSON.stringify(env).length;
    this.sent.set(env.msg.kind, acc);
    if (env.msg.kind === "resync") this.resyncSent++;
  }

  recordReceived(env: SpikeDelivered, receivedAt: number): void {
    const { msg } = env;
    const acc = this.received.get(msg.kind) ?? { count: 0, bytes: 0, latency: [], mainHop: [] };
    acc.count++;
    const { relayedAt, ...plain } = env;
    acc.bytes += JSON.stringify(plain).length;
    push(acc.latency, receivedAt - env.sentAt);
    push(acc.mainHop, relayedAt - env.sentAt);
    this.received.set(msg.kind, acc);

    if (msg.kind === "stream") {
      const last = this.lastSeq.get(msg.toolCallId);
      if (last === undefined) {
        if (msg.seq > 0) this.gaps += msg.seq;
      } else if (msg.seq <= last) {
        this.outOfOrder++;
      } else if (msg.seq > last + 1) {
        this.gaps += msg.seq - last - 1;
      }
      if (last === undefined || msg.seq > last) this.lastSeq.set(msg.toolCallId, msg.seq);
    } else if (msg.kind === "resync") {
      this.resyncReceived++;
    } else if (msg.kind === "error") {
      this.errors++;
    } else if (msg.kind === "peer-gone") {
      this.peerGone++;
    }
  }

  recordIgnoredFrame(): void {
    this.ignored++;
  }
  recordContextRequest(): void {
    this.ctxRequests++;
  }
  recordContextRoundTrip(ms: number): void {
    push(this.ctxRoundTrips, ms);
  }
  recordContextFallback(): void {
    this.ctxFallbacks++;
  }

  /** Canvas side: `version` is any identity token of the scene state the answer was built from. */
  recordContextAnswer(version: unknown, canvasContext: string): void {
    this.ctxAnswered++;
    const hash = hashString(canvasContext);
    const known = this.versionHashes.get(version);
    if (known === undefined) {
      this.versionHashes.set(version, hash);
      return;
    }
    this.versionsRepeated++;
    this.stable = (this.stable ?? true) && known === hash;
  }

  snapshot(): SpikeStats {
    const received: SpikeStats["received"] = {};
    for (const [kind, acc] of this.received) {
      received[kind] = {
        count: acc.count,
        bytes: acc.bytes,
        latencyMs: dist(acc.latency),
        mainHopMs: dist(acc.mainHop),
      };
    }
    const sent: SpikeStats["sent"] = {};
    for (const [kind, acc] of this.sent) sent[kind] = { ...acc };
    return {
      received,
      sent,
      seq: { gaps: this.gaps, outOfOrder: this.outOfOrder },
      resyncs: { sent: this.resyncSent, received: this.resyncReceived },
      ignoredFrames: this.ignored,
      errors: this.errors,
      peerGone: this.peerGone,
      context: {
        requests: this.ctxRequests,
        roundTripMs: dist(this.ctxRoundTrips),
        fallbacks: this.ctxFallbacks,
        answered: this.ctxAnswered,
        versionsRepeated: this.versionsRepeated,
      },
      contextStable: this.stable,
    };
  }
}
