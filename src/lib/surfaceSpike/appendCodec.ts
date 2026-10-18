// SPIKE(ipc-streaming): partial tool input -> "stream" messages and back.
import type { SpikeFormat, SpikeMsg } from "./types";

type Input = Record<string, unknown>;
type StreamMsg = Extract<SpikeMsg, { kind: "stream" }>;

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Sender side, one per tool call. The first message and any message that
 * cannot be expressed as an append are "full". An append carries the growth
 * of ONE top-level string field whose new value starts with the value sent
 * before; `rest` (all other top-level fields) rides along only when one of
 * them changed.
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
  encode(input: Input, format: SpikeFormat): StreamMsg | null {
    const prev = this.prev;
    this.prev = input;
    const base = { kind: "stream" as const, toolCallId: this.toolCallId, toolName: this.toolName };
    const full = (): StreamMsg => {
      this.needFull = false;
      return { ...base, seq: this.seq++, format: "full", input };
    };
    if (format === "full" || prev === null || this.needFull) {
      if (prev !== null && !this.needFull && sameJson(prev, input)) return null;
      return full();
    }

    const keys = Object.keys(input);
    if (Object.keys(prev).some((k) => !(k in input))) return full();
    let grown: string | null = null;
    for (const key of keys) {
      const before = prev[key];
      const now = input[key];
      if (typeof now === "string" && typeof before === "string" && now !== before) {
        if (!now.startsWith(before) || grown !== null) return full();
        grown = key;
      }
    }
    if (grown === null) {
      // No string grew. Either nothing changed, or only other fields did.
      return sameJson(prev, input) ? null : full();
    }
    let restChanged = false;
    const rest: Input = {};
    for (const key of keys) {
      if (key === grown) continue;
      rest[key] = input[key];
      if (!(key in prev) || !sameJson(prev[key], input[key])) restChanged = true;
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
  | { status: "resync" }
  | { status: "ignored" };

/** Receiver side, one per tool call. */
export class AppendDecoder {
  private input: Input | null = null;
  private awaitingFull = false;

  apply(msg: StreamMsg): DecodeResult {
    if (msg.format === "full") {
      const input = msg.input;
      this.input = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Input) : {};
      this.awaitingFull = false;
      return { status: "input", input: this.input };
    }
    if (this.awaitingFull) return { status: "ignored" };
    const current = this.input;
    const have = current?.[msg.field];
    if (current === null || typeof have !== "string" || have.length !== msg.offset) {
      this.awaitingFull = true;
      return { status: "resync" };
    }
    const next: Input = { ...(msg.rest ?? omit(current, msg.field)) };
    next[msg.field] = have + msg.append;
    this.input = next;
    return { status: "input", input: next };
  }
}

function omit(input: Input, key: string): Input {
  const copy: Input = {};
  for (const k of Object.keys(input)) if (k !== key) copy[k] = input[k];
  return copy;
}
