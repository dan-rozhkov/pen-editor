// Partial tool input -> "stream" messages and back (canvas link, see ./protocol).
import type { PatchOp, PatchPath, StreamMsg } from "./protocol";

type Input = Record<string, unknown>;

/** Identity first; JSON only when both values are non-null objects. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Collects the ops that turn `prev` into `next`. False when the change is not
 * expressible (removed key, non-prefix string change, type change, shorter array).
 */
function diffInto(prev: unknown, next: unknown, path: PatchPath, ops: PatchOp[]): boolean {
  if (typeof prev === "string" && typeof next === "string") {
    if (prev === next) return true;
    if (!next.startsWith(prev)) return false;
    ops.push({ path, op: "append", offset: prev.length, text: next.slice(prev.length) });
    return true;
  }
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (next.length < prev.length) return false;
    for (let i = 0; i < prev.length; i++) if (!diffInto(prev[i], next[i], [...path, i], ops)) return false;
    for (let i = prev.length; i < next.length; i++) ops.push({ path: [...path, i], op: "set", value: next[i] });
    return true;
  }
  if (isPlain(prev) && isPlain(next)) {
    for (const k of Object.keys(prev)) if (!(k in next)) return false;
    for (const k of Object.keys(next)) {
      if (!(k in prev)) ops.push({ path: [...path, k], op: "set", value: next[k] });
      else if (!diffInto(prev[k], next[k], [...path, k], ops)) return false;
    }
    return true;
  }
  return prev === next;
}

const BAD = Symbol("bad");

/** Copy-on-write application of one op below `node`; BAD when the path or offset does not fit. */
function patchAt(node: unknown, op: PatchOp, i: number): unknown {
  const { path } = op;
  if (i === path.length) {
    return op.op === "append" && typeof node === "string" && node.length === op.offset ? node + op.text : BAD;
  }
  const key = path[i];
  const last = i === path.length - 1;
  if (Array.isArray(node)) {
    if (typeof key !== "number" || !Number.isInteger(key) || key < 0) return BAD;
    if (last && op.op === "set") return key === node.length ? [...node, op.value] : BAD;
    if (key >= node.length) return BAD;
    const child = patchAt(node[key], op, i + 1);
    if (child === BAD) return BAD;
    const copy = node.slice();
    copy[key] = child;
    return copy;
  }
  if (isPlain(node)) {
    if (typeof key !== "string") return BAD;
    if (last && op.op === "set") return { ...node, [key]: op.value };
    if (!Object.hasOwn(node, key)) return BAD;
    const child = patchAt(node[key], op, i + 1);
    return child === BAD ? BAD : { ...node, [key]: child };
  }
  return BAD;
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
    // A deep copy: the caller may mutate its object (nested too) between calls.
    this.prev = structuredClone(input);
    const base = { kind: "stream" as const, toolCallId: this.toolCallId, toolName: this.toolName };
    const full = (): StreamMsg => {
      this.needFull = false;
      return { ...base, seq: this.seq++, format: "full", input };
    };
    if (prev === null || this.needFull) return full();

    const top = this.encodeTopLevel(prev, input, base);
    if (top !== "fallback") return top;
    const ops: PatchOp[] = [];
    if (!diffInto(prev, input, [], ops)) return full();
    if (ops.length === 0) return null;
    if (JSON.stringify(ops).length >= JSON.stringify(input).length) return full();
    return { ...base, seq: this.seq++, format: "patch", ops };
  }

  /** The compact single-field append; "fallback" when it cannot express the change. */
  private encodeTopLevel(
    prev: Input,
    input: Input,
    base: { kind: "stream"; toolCallId: string; toolName: string },
  ): StreamMsg | null | "fallback" {
    const full = "fallback" as const;
    const keys = Object.keys(input);
    if (Object.keys(prev).some((k) => !(k in input))) return full;
    let grown: string | null = null;
    let restChanged = false;
    for (const key of keys) {
      const before = prev[key];
      const now = input[key];
      if (typeof now === "string" && typeof before === "string") {
        if (now === before) continue;
        if (!now.startsWith(before) || grown !== null) return full;
        grown = key;
      } else if (!(key in prev) || !sameValue(before, now)) {
        restChanged = true;
      }
    }
    if (grown === null) {
      // No string grew. Either nothing changed, or only other fields did.
      return restChanged ? full : null;
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
    if (msg.format === "patch") {
      let next: unknown = current;
      if (current === null) return this.resync();
      for (const op of msg.ops) {
        next = patchAt(next, op, 0);
        if (next === BAD) return this.resync();
      }
      this.input = next as Input;
      return { status: "input", input: this.input };
    }
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
