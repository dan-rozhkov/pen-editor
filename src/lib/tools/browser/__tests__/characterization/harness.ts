import { vi } from "vitest";
import type { PenDesktopBrowser } from "../helpers";

// Shared harness for the browse_* CHARACTERIZATION suites: a recording fake
// bridge (every call logged as {method, args}, results scripted per call) and
// a recording stub for the /api/browse/locate transport. These suites pin the
// pre-refactor behavior, so they must stay unchanged after the handlers are
// moved onto @sideform/browser-agent.

export type BridgeMethod =
  | "open"
  | "act"
  | "snapshot"
  | "findImages"
  | "read"
  | "perform"
  | "screenshot"
  | "tabs"
  | "capture";

export interface BridgeCall {
  method: BridgeMethod;
  args: unknown[];
}

/** A scripted step that makes the bridge method reject with `error`. */
export class Throws {
  constructor(readonly error: unknown) {}
}
export const throws = (error: unknown) => new Throws(error);

type Step = unknown | Throws | ((...args: unknown[]) => unknown);
export type BridgeScript = Partial<Record<BridgeMethod, Step[]>>;

export interface RecordingBridge {
  browser: PenDesktopBrowser;
  /** Every call in order, args deep-cloned at call time. */
  calls: BridgeCall[];
  /** Calls to one method only. */
  callsTo(method: BridgeMethod): BridgeCall[];
  /** The method names in call order. */
  methods(): BridgeMethod[];
}

const ALL_METHODS: BridgeMethod[] = [
  "open", "act", "snapshot", "findImages", "read", "perform", "screenshot", "tabs", "capture",
];

/**
 * Builds a fake `window.penDesktop.browser`. Each method consumes its script
 * in order; once exhausted it repeats the LAST step (so `[x]` means "always
 * x"); a method with no script resolves `{}`. A step may be a plain value, a
 * `throws(err)`, or a function receiving the call's arguments (it may return
 * a promise). `omit` leaves methods off the object (older desktop builds).
 */
export function makeBridge(script: BridgeScript = {}, omit: BridgeMethod[] = []): RecordingBridge {
  const calls: BridgeCall[] = [];
  const cursors: Partial<Record<BridgeMethod, number>> = {};
  const browser: Record<string, unknown> = {};
  for (const method of ALL_METHODS) {
    if (omit.includes(method)) continue;
    browser[method] = async (...args: unknown[]) => {
      calls.push({ method, args: structuredClone(args) });
      const steps = script[method];
      if (!steps || steps.length === 0) return {};
      const at = cursors[method] ?? 0;
      cursors[method] = at + 1;
      const step = steps[Math.min(at, steps.length - 1)];
      if (step instanceof Throws) throw step.error;
      if (typeof step === "function") return (step as (...a: unknown[]) => unknown)(...args);
      return step;
    };
  }
  return {
    browser: browser as unknown as PenDesktopBrowser,
    calls,
    callsTo: (method) => calls.filter((c) => c.method === method),
    methods: () => calls.map((c) => c.method),
  };
}

/** Installs the bridge as `window.penDesktop.browser`. */
export function installBridge(bridge: RecordingBridge): RecordingBridge {
  window.penDesktop = { onMenuCommand: () => () => {}, browser: bridge.browser };
  return bridge;
}

/** `makeBridge` + `installBridge` in one step. */
export function bridgeWith(script: BridgeScript = {}, omit: BridgeMethod[] = []): RecordingBridge {
  return installBridge(makeBridge(script, omit));
}

export const PAGE_URL = "https://example.com/";

/** A well-formed snapshot (passes the package's isSnapshotResult). */
export function snap(
  snapshotId: string,
  elements: unknown[] = [{ index: 0, tag: "button", label: "Go", ops: ["CLICK"] }]
) {
  return { url: PAGE_URL, title: "Example", elements, snapshotId };
}

/** snapshot script for n calls that each do "pre-snapshot ok, trailing snapshot fails". */
export function snapThenFail(pre: unknown, n: number): unknown[] {
  return Array.from({ length: n * 2 }, (_, i) => (i % 2 === 0 ? pre : { error: "no trailing snapshot" }));
}

export const j = (value: unknown): string => JSON.stringify(value);

// ---- /api/browse/locate transport ------------------------------------------

export interface LocateReply {
  status?: number;
  body?: unknown;
  /** `Retry-After` header value, as the server would send it. */
  retryAfter?: string;
  /** res.json() rejects (non-JSON body). */
  badJson?: boolean;
  /** fetch itself rejects with this. */
  reject?: unknown;
}

export interface LocateRequest {
  url: string;
  method: unknown;
  body: Record<string, unknown>;
  rawBody: string;
  hasSignal: boolean;
}

/**
 * Stubs global fetch for the locate route. Replies are consumed in order and
 * the last repeats. Returns the request log.
 */
export function stubLocate(replies: LocateReply[]) {
  const requests: LocateRequest[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const rawBody = String(init?.body ?? "");
    requests.push({
      url: String(url),
      method: init?.method,
      body: JSON.parse(rawBody) as Record<string, unknown>,
      rawBody,
      hasSignal: init?.signal instanceof AbortSignal,
    });
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
    if (reply.reject !== undefined) throw reply.reject;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (reply.badJson) throw new SyntaxError("Unexpected token");
        return reply.body;
      },
      headers: { get: (name: string) => (name === "Retry-After" ? (reply.retryAfter ?? null) : null) },
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requests };
}

export const FOUND = (index: number, extra: Record<string, unknown> = {}) => ({
  outcome: "found",
  index,
  label: "Go",
  confidence: 0.9,
  model: "m",
  ...extra,
});

/** Standard afterEach for these suites. */
export function resetEnvironment(): void {
  delete window.penDesktop;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // The browse_task action cache persists to real localStorage.
  localStorage.clear();
}
