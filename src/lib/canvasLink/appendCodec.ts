// Partial tool input -> "stream" messages and back (canvas link, see ./protocol).
import type { StreamMsg } from "./protocol";

type Input = Record<string, unknown>;

/** Identity first; JSON only when both values are non-null objects. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Sender side, one per tool call. The first message and any message that
 * cannot be expressed as an append are "full". An append carries the growth
 * of ONE top-level string field whose new value starts with the value sent
 * before; `rest` (all other top-level fields) rides along only when one of
 * them changed. Fields are compared one by one, so key order never matters.
 */
export class AppendEncoder {
  private prev: Input | null = null;
  private seq = 0;
  private needFull = false;

  private readonly toolCallId: string;
  private readonly toolName: string;

  constructor(toolCallId: string, toolName: string) {
    this.toolCallId = toolCallId;
    this.toolName = toolName;
  }

  /** The receiver lost track: the next message is "full". */
  forceFull(): void {
    this.needFull = true;
  }

  /** Returns null when nothing changed since the last message. */
  encode(input: Input): StreamMsg | null {
    const prev = this.prev;
    // A shallow copy: the caller may mutate its object between calls.
    this.prev = { ...input };
    const base = { kind: "stream" as const, toolCallId: this.toolCallId, toolName: this.toolName };
    const full = (): StreamMsg => {
      this.needFull = false;
      return { ...base, seq: this.seq++, format: "full", input };
    };
    if (prev === null || this.needFull) return full();

    const keys = Object.keys(input);
    if (Object.keys(prev).some((k) => !(k in input))) return full();
    let grown: string | null = null;
    let restChanged = false;
    for (const key of keys) {
      const before = prev[key];
      const now = input[key];
      if (typeof now === "string" && typeof before === "string") {
        if (now === before) continue;
        if (!now.startsWith(before) || grown !== null) return full();
        grown = key;
      } else if (!(key in prev) || !sameValue(before, now)) {
        restChanged = true;
      }
    }
    if (grown === null) {
      // No string grew. Either nothing changed, or only other fields did.
      return restChanged ? full() : null;
    }
    const rest: Input = {};
    for (const key of keys) {
      if (key === grown) continue;
      rest[key] = input[key];
    }
    const before = prev[grown] as string;
    const now = input[grown] as string;
    return {
      ...base,
      seq: this.seq++,
      format: "append",
      field: grown,
      offset: before.length,
      append: now.slice(before.length),
      ...(restChanged ? { rest } : {}),
    };
  }
}

export type DecodeResult =
  | { status: "input"; input: Input }
  /** Send `resync` to the sender now. */
  | { status: "resync" }
  | { status: "ignored" };

/** Minimum gap between two `resync` answers for one tool call. */
export const RESYNC_INTERVAL_MS = 250;

/** Receiver side, one per tool call. */
export class AppendDecoder {
  private input: Input | null = null;
  private lastSeq = -1;
  private awaitingFull = false;
  private lastResyncAt = Number.NEGATIVE_INFINITY;

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  apply(msg: StreamMsg): DecodeResult {
    if (this.awaitingFull) {
      // Lost sync: only a "full" helps, whatever its seq.
      if (msg.format !== "full") return this.resync();
    } else if (msg.seq !== this.lastSeq + 1 || (this.lastSeq === -1 && msg.format !== "full")) {
      return this.resync();
    }
    this.lastSeq = msg.seq;
    if (msg.format === "full") {
      const input = msg.input;
      this.input = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Input) : {};
      this.awaitingFull = false;
      return { status: "input", input: this.input };
    }
    const current = this.input;
    const have = current?.[msg.field];
    if (current === null || typeof have !== "string" || have.length !== msg.offset) {
      return this.resync();
    }
    const next: Input = { ...(msg.rest ?? omit(current, msg.field)) };
    next[msg.field] = have + msg.append;
    this.input = next;
    return { status: "input", input: next };
  }

  private resync(): DecodeResult {
    this.awaitingFull = true;
    const t = this.now();
    if (t - this.lastResyncAt < RESYNC_INTERVAL_MS) return { status: "ignored" };
    this.lastResyncAt = t;
    return { status: "resync" };
  }
}

function omit(input: Input, key: string): Input {
  const copy: Input = {};
  for (const k of Object.keys(input)) if (k !== key) copy[k] = input[k];
  return copy;
}
