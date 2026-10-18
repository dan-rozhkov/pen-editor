/**
 * Canvas link, agent-panel side (docs/canvas-link.md). The panel's chat has no
 * scene: this client binds each chat session to one canvas tab and sends it the
 * canvas tools' streaming input, the completed calls, `place-node` writes of
 * panel-run browser tools and `context-request`s. React-free: the bridge and
 * the clock are injected, so the whole thing runs against an in-memory fake.
 *
 * Invariants:
 * - Every promise returned here resolves, none rejects (errors are
 *   `{"error": "..."}` strings, as tool results).
 * - `tab-gone` is a latch per registration (`tabId` + `registrationId`): its
 *   pending calls fail at once, its streams end, nothing is ever sent to it
 *   again and the binding is cleared. A reload registers anew and is usable.
 */
import { AppendEncoder } from "./appendCodec";
import {
  linkNow,
  type AgentPanelCanvasBridge,
  type CanvasTabInfo,
  type CanvasToChatMsg,
  type ChatLaunchMessagePayload,
  type ChatToCanvasMsg,
  type LinkEnvelope,
  type MainToChatMsg,
} from "./protocol";

/** Added to the per-tool timeout so the canvas tab's own timeout error wins the race. */
export const CALL_TIMEOUT_MARGIN_MS = 2000;
export const CONTEXT_TIMEOUT_MS = 2000;
export const PLACE_NODE_TIMEOUT_MS = 30_000;
/**
 * Safety net for a `call` the tab has not reported `started` for. The real
 * budget (`timeoutMs + 2 s`) starts on `started`, so a call queued behind a
 * long one is not timed out here; this only frees a chat whose tab went silent
 * without a `tab-gone` (or whose host predates `started`).
 */
export const PRE_START_TIMEOUT_MS = 10 * 60_000;
const MAX_ENDED_STREAMS = 500;

export const TAB_CLOSED_ERROR = JSON.stringify({ error: "The canvas tab was closed." });
const TAB_CLOSED_ERROR_OBJ = { error: "The canvas tab was closed." };
const errorResult = (message: string) => JSON.stringify({ error: message });

export interface Binding {
  tabId: number;
  registrationId: number;
}

export type PlaceNodeResult = { id: string; x: number; y: number } | { error: string };

/** Why a canvas call failed without reaching (or without hearing from) the tab's handler. */
export type CallFailureKind = "tab_gone" | "main_error" | "timeout" | "bind_failed";

export interface CallFailure {
  toolName: string;
  kind: CallFailureKind;
  durationMs: number;
}

export interface PanelClientDeps {
  bridge: AgentPanelCanvasBridge;
  /**
   * Analytics seam. The tab's `executeToolCall` reports every call that reached
   * its handler, so this fires only for failures the tab did not report.
   */
  onCallFailed?: (failure: CallFailure) => void;
  /** Epoch ms stamped on envelopes (`sentAt`). Default: `linkNow`. */
  now?: () => number;
  /** A canvas tab's `launch` (an on-canvas agent entry point). Each `launchId` is delivered once. */
  onLaunch?: (launch: { tabId: number; launchId: string; payload: ChatLaunchMessagePayload }) => void;
}

export interface CallOptions {
  toolCallId: string;
  /** The chat side's per-tool budget; the client waits this + 2 s. */
  timeoutMs: number;
  signal?: AbortSignal;
}

type Outgoing = ChatToCanvasMsg;

interface Stream {
  sessionId: string;
  encoder: AppendEncoder;
  /** null until the first frame's binding resolved. */
  binding: Binding | null;
  /** Encoded messages waiting for the binding (frames while `openTab()` is pending), in order. */
  buffer: Outgoing[];
  /** The binding could not be made: later frames are dropped. */
  dead: boolean;
}

interface Pending {
  key: string | null;
  /** A context request settles "" (= no context) where a call settles an error result. */
  isContext: boolean;
  /** The tab the request went to (null until sent). */
  tab: Binding | null;
  /** The tab began running the call (`started`). */
  onStarted?: () => void;
  /** `failure` names the panel-side reason when this settle is a failure that never got a tab answer. */
  settle(result: string, failure?: CallFailureKind): void;
}

const keyOf = (b: Binding) => `${b.tabId}:${b.registrationId}`;

export class PanelClient {
  private readonly bridge: AgentPanelCanvasBridge;
  private readonly now: () => number;
  private readonly onCallFailed?: (failure: CallFailure) => void;
  private readonly onLaunch?: PanelClientDeps["onLaunch"];
  private readonly seenLaunches = new Set<string>();
  private tabs: CanvasTabInfo[] = [];
  private readonly bindings = new Map<string, Binding>();
  private readonly binding$ = new Map<string, Promise<Binding | null>>();
  private readonly latched = new Set<string>();
  private readonly streams = new Map<string, Stream>();
  /** Calls whose stream is closed: a late frame for one must not reopen it. */
  private readonly ended = new Set<string>();
  private readonly pending = new Map<string, Pending>();
  private readonly byEnvelope = new Map<string, string>();
  /** The last canvasContext each chat received from its tab. */
  private readonly lastContext = new Map<string, string>();
  private counter = 0;
  private readonly unsubscribers: Array<() => void>;

  constructor(deps: PanelClientDeps) {
    this.bridge = deps.bridge;
    this.now = deps.now ?? linkNow;
    this.onCallFailed = deps.onCallFailed;
    this.onLaunch = deps.onLaunch;
    this.unsubscribers = [
      deps.bridge.onTabsChanged((tabs) => {
        this.tabs = tabs;
      }),
      deps.bridge.onMessage((tabId, env) => this.handle(tabId, env)),
    ];
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    for (const p of [...this.pending.values()]) p.settle(errorResult("The agent panel closed."));
    this.streams.clear();
  }

  /** The live binding of a chat, or null. */
  getBinding(sessionId: string): Binding | null {
    return this.bindings.get(sessionId) ?? null;
  }

  /**
   * Binds a chat to a given canvas tab (the sender of a `launch`), replacing any binding.
   * Looks the registration up in the tab list (refreshed first). Null = the tab is not
   * listed or its registration is latched; the chat stays as it was.
   */
  async bindTo(sessionId: string, tabId: number): Promise<Binding | null> {
    try {
      this.tabs = await this.bridge.listTabs();
    } catch {
      // Judge by the last known list.
    }
    const listed = this.tabs.find((t) => t.tabId === tabId);
    if (!listed) return null;
    const binding = { tabId: listed.tabId, registrationId: listed.registrationId };
    if (this.latched.has(keyOf(binding))) return null;
    if (this.bindings.get(sessionId) && keyOf(this.bindings.get(sessionId)!) !== keyOf(binding)) this.lastContext.delete(sessionId);
    this.bindings.set(sessionId, binding);
    return binding;
  }

  /** Forgets a chat's binding (not the tab). */
  forgetSession(sessionId: string): void {
    this.dropBinding(sessionId);
  }

  /** A binding is gone for good (forgotten or latched): the context of its document goes with it. */
  private dropBinding(sessionId: string): void {
    this.bindings.delete(sessionId);
    this.lastContext.delete(sessionId);
  }

  // ---- sending -------------------------------------------------------------

  private post(tabId: number, msg: Outgoing): string {
    const id = `p${++this.counter}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      this.bridge.post(tabId, { id, sentAt: this.now(), msg });
    } catch {
      // A throwing bridge must not break the chat; the timeouts report it.
    }
    return id;
  }

  // ---- binding -------------------------------------------------------------

  /** The binding if it is still valid (not latched, not reloaded behind our back). */
  private liveBinding(sessionId: string): Binding | null {
    const b = this.bindings.get(sessionId);
    if (!b) return null;
    if (this.latched.has(keyOf(b))) {
      this.dropBinding(sessionId);
      return null;
    }
    const listed = this.tabs.find((t) => t.tabId === b.tabId);
    if (listed && listed.registrationId !== b.registrationId) {
      // Reloaded without a tab-gone reaching us (yet): the old registration is dead.
      this.latchRegistration(b.tabId, b.registrationId);
      return null;
    }
    return b;
  }

  /** Resolve per docs/canvas-link.md "Binding"; shares one in-flight resolution per chat. */
  private bind(sessionId: string): Promise<Binding | null> {
    const live = this.liveBinding(sessionId);
    if (live) return Promise.resolve(live);
    const inFlight = this.binding$.get(sessionId);
    if (inFlight) return inFlight;
    const p = this.resolveBinding(sessionId).finally(() => {
      this.binding$.delete(sessionId);
    });
    this.binding$.set(sessionId, p);
    return p;
  }

  private async resolveBinding(sessionId: string): Promise<Binding | null> {
    try {
      const listed = await this.bridge.listTabs();
      this.tabs = listed;
      const usable = listed.find((t) => !this.latched.has(`${t.tabId}:${t.registrationId}`));
      let binding: Binding | null = usable ? { tabId: usable.tabId, registrationId: usable.registrationId } : null;
      if (!binding) {
        // `openTab()` answers with the registration it waited for: never look it up
        // in the tab list, which may not have announced the new tab yet (binding with a
        // guessed registrationId would later read as a reload and latch the tab).
        const opened = await this.bridge.openTab();
        if (!opened || typeof opened.tabId !== "number" || typeof opened.registrationId !== "number") return null;
        binding = { tabId: opened.tabId, registrationId: opened.registrationId };
      }
      if (this.latched.has(keyOf(binding))) return null;
      this.bindings.set(sessionId, binding);
      return binding;
    } catch {
      return null;
    }
  }

  /**
   * Binds a chat to the first registered canvas tab WITHOUT opening one, so the
   * first message of a chat can carry that tab's `canvasContext`. No tab: stays unbound.
   */
  private async bindPassively(sessionId: string): Promise<void> {
    if (this.binding$.has(sessionId)) return; // a call is resolving (maybe opening) it
    try {
      const listed = await this.bridge.listTabs();
      this.tabs = listed;
      if (this.liveBinding(sessionId) || this.binding$.has(sessionId)) return;
      const usable = listed.find((t) => !this.latched.has(`${t.tabId}:${t.registrationId}`));
      if (usable) this.bindings.set(sessionId, { tabId: usable.tabId, registrationId: usable.registrationId });
    } catch {
      // Stays unbound.
    }
  }

  /**
   * Explicit (model-requested) binding, for `open_canvas_tab`. "current": the first usable
   * listed tab (most recently active), opened if there is none, and activated. "new": a freshly
   * opened, activated tab. The chat's previous tab is released WITHOUT latching it (other chats may
   * still use it); the chat's remembered context goes, so the next request carries the new tab's.
   * Never rejects.
   */
  async bindExplicit(
    sessionId: string,
    target: "new" | "current",
    signal?: AbortSignal
  ): Promise<{ tabId: number; title: string; opened: boolean } | { error: string }> {
    const aborted = { error: "Tool call aborted" };
    if (signal?.aborted) return aborted;
    try {
      // A call resolving this chat's binding right now must not overwrite ours afterwards.
      await this.binding$.get(sessionId);
      let binding: Binding | null = null;
      let opened = false;
      if (target === "current") {
        const listed = await this.bridge.listTabs();
        this.tabs = listed;
        const usable = listed.find((t) => !this.latched.has(`${t.tabId}:${t.registrationId}`));
        if (usable) binding = { tabId: usable.tabId, registrationId: usable.registrationId };
      }
      if (!binding) {
        const made = await this.bridge.openTab({ activate: true });
        if (!made || typeof made.tabId !== "number" || typeof made.registrationId !== "number") {
          return { error: "Could not open a canvas tab." };
        }
        binding = { tabId: made.tabId, registrationId: made.registrationId };
        opened = true;
      } else {
        this.bridge.activateTab(binding.tabId);
      }
      if (signal?.aborted) return aborted;
      if (this.latched.has(keyOf(binding))) return TAB_CLOSED_ERROR_OBJ;
      const previous = this.bindings.get(sessionId);
      if (!previous || keyOf(previous) !== keyOf(binding)) this.lastContext.delete(sessionId);
      this.bindings.set(sessionId, binding);
      let title = this.tabs.find((t) => t.tabId === binding!.tabId)?.title;
      if (title === undefined) {
        try {
          this.tabs = await this.bridge.listTabs();
          title = this.tabs.find((t) => t.tabId === binding!.tabId)?.title;
        } catch {
          // Keep the fallback.
        }
      }
      return { tabId: binding.tabId, title: title ?? "Untitled", opened };
    } catch {
      return { error: "Could not open a canvas tab." };
    }
  }

  // ---- streaming -----------------------------------------------------------

  /**
   * Forward one partial input of a canvas tool call. Never throws. The first
   * frame binds the chat (opening a canvas tab if there is none); frames that
   * arrive while that is pending are buffered and flushed in order.
   */
  forwardFrame(sessionId: string, toolCallId: string, toolName: string, input: Record<string, unknown>): void {
    if (this.ended.has(toolCallId)) return;
    let stream = this.streams.get(toolCallId);
    if (!stream) {
      stream = {
        sessionId,
        encoder: new AppendEncoder(toolCallId, toolName),
        binding: null,
        buffer: [],
        dead: false,
      };
      this.streams.set(toolCallId, stream);
    }
    if (stream.dead) return;
    const msg = stream.encoder.encode(input);
    if (!msg) return;
    if (stream.binding) {
      if (this.latched.has(keyOf(stream.binding))) return;
      this.post(stream.binding.tabId, msg);
      return;
    }
    const first = stream.buffer.length === 0;
    stream.buffer.push(msg);
    if (!first) return;
    const mine = stream;
    void this.bind(sessionId).then((binding) => {
      if (this.streams.get(toolCallId) !== mine) return; // ended or latched meanwhile
      if (!binding) {
        mine.dead = true;
        mine.buffer = [];
        return;
      }
      this.flush(mine, binding);
    });
  }

  private flush(stream: Stream, binding: Binding): void {
    if (!stream.binding) stream.binding = binding;
    const buffered = stream.buffer;
    stream.buffer = [];
    for (const msg of buffered) this.post(binding.tabId, msg);
  }

  /** Closes a stream if open. Idempotent. A stream still waiting for its binding gets the end queued in order. */
  endStream(toolCallId: string, reason: "complete" | "abandoned"): void {
    this.markEnded(toolCallId);
    const stream = this.streams.get(toolCallId);
    if (!stream) return;
    this.streams.delete(toolCallId);
    if (stream.dead) return;
    const msg: Outgoing = { kind: "stream-end", toolCallId, reason };
    if (stream.binding) {
      if (!this.latched.has(keyOf(stream.binding))) this.post(stream.binding.tabId, msg);
      return;
    }
    // Still waiting for the binding: the stream is out of `streams` so its flush
    // would be skipped. A stream that never reached the canvas has nothing to end.
  }

  private markEnded(toolCallId: string): void {
    this.ended.add(toolCallId);
    if (this.ended.size > MAX_ENDED_STREAMS) this.ended.delete(this.ended.values().next().value as string);
  }

  // ---- requests ------------------------------------------------------------

  /**
   * Runs a completed canvas tool call in the bound canvas tab. Resolves with
   * the tab's result string, or `{"error": ...}` (main error, tab gone,
   * timeout of `timeoutMs + 2 s`, abort).
   */
  callTool(sessionId: string, toolName: string, input: unknown, options: CallOptions): Promise<string> {
    const { toolCallId, timeoutMs, signal } = options;
    // Close the stream first; if its frames still wait for the tab, flush them before the call.
    const stream = this.streams.get(toolCallId);
    this.endStream(toolCallId, "complete");
    return this.request({
      callId: toolCallId,
      sessionId,
      toolName,
      timeoutMs: timeoutMs + CALL_TIMEOUT_MARGIN_MS,
      timeoutMessage: `Tool ${toolName} timed out waiting for the canvas tab`,
      startGated: true,
      signal,
      cancelOnAbort: true,
      send: (binding, callId) => {
        if (stream && !stream.binding && stream.buffer.length > 0) {
          const buffered = stream.buffer;
          stream.buffer = [];
          for (const msg of buffered) this.post(binding.tabId, msg);
          this.post(binding.tabId, { kind: "stream-end", toolCallId, reason: "complete" });
        }
        return this.post(binding.tabId, { kind: "call", callId, toolName, input, timeoutMs });
      },
    });
  }

  /** The one scene write of a panel-run browser tool. Resolves the canvas tab's parsed answer. */
  async placeNode(
    sessionId: string,
    node: unknown,
    options: unknown,
    signal?: AbortSignal
  ): Promise<PlaceNodeResult> {
    const callId = `place-${++this.counter}-${Math.random().toString(36).slice(2, 8)}`;
    const raw = await this.request({
      callId,
      sessionId,
      timeoutMs: PLACE_NODE_TIMEOUT_MS + CALL_TIMEOUT_MARGIN_MS,
      timeoutMessage: "Placing the node timed out waiting for the canvas tab",
      signal,
      cancelOnAbort: true,
      send: (binding, id) => this.post(binding.tabId, { kind: "place-node", callId: id, node, options }),
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: raw };
    }
    if (parsed && typeof parsed === "object") {
      const p = parsed as Record<string, unknown>;
      if (typeof p.id === "string" && typeof p.x === "number" && typeof p.y === "number") {
        return { id: p.id, x: p.x, y: p.y };
      }
      if (typeof p.error === "string") return { error: p.error };
    }
    return { error: "The canvas tab returned an invalid placement." };
  }

  /** Shared body of callTool/placeNode: bind (opening if needed), send, wait for `result`. Never rejects. */
  private request(spec: {
    callId: string;
    sessionId: string;
    /** Reported to `onCallFailed` on failures; omitted = not a tool call (place-node). */
    toolName?: string;
    /** The timer starts on the tab's `started`; until then only `PRE_START_TIMEOUT_MS` applies. */
    startGated?: boolean;
    timeoutMs: number;
    timeoutMessage: string;
    signal?: AbortSignal;
    cancelOnAbort: boolean;
    send(binding: Binding, callId: string): string;
  }): Promise<string> {
    const { callId, signal } = spec;
    const startedAt = performance.now();
    return new Promise<string>((resolve) => {
      let binding: Binding | null = null;
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const pending: Pending = {
        key: null,
        isContext: false,
        tab: null,
        settle: (result, failure) => {
          if (done) return;
          done = true;
          if (timer !== undefined) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          this.pending.delete(callId);
          resolve(result);
          if (failure && spec.toolName) {
            try {
              this.onCallFailed?.({
                toolName: spec.toolName,
                kind: failure,
                durationMs: Math.round(performance.now() - startedAt),
              });
            } catch {
              // An observer must not break the never-rejects contract.
            }
          }
        },
      };
      /** Settles with `message` and tells the tab to drop the call if it was sent. */
      const fail = (message: string, failure?: CallFailureKind) => {
        const sent = binding;
        pending.settle(errorResult(message), failure);
        if (sent && spec.cancelOnAbort && !this.latched.has(keyOf(sent))) {
          this.post(sent.tabId, { kind: "cancel", callId });
        }
      };
      const arm = (ms: number) => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => fail(spec.timeoutMessage, "timeout"), ms);
      };
      const onAbort = () => fail("Tool call aborted");
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort);
      this.pending.set(callId, pending);

      void this.bind(spec.sessionId).then((b) => {
        if (done) return;
        if (!b) return pending.settle(errorResult("Could not open a canvas tab."), "bind_failed");
        if (this.latched.has(keyOf(b))) return pending.settle(TAB_CLOSED_ERROR, "tab_gone");
        binding = b;
        pending.key = keyOf(b);
        pending.tab = b;
        this.byEnvelope.set(spec.send(b, callId), callId);
        // The budget runs from the post, or from the tab's `started` for gated
        // calls: binding / openTab() / queue time is not charged to it.
        if (spec.startGated) {
          pending.onStarted = () => {
            if (!done) arm(spec.timeoutMs);
          };
          arm(PRE_START_TIMEOUT_MS);
        } else {
          arm(spec.timeoutMs);
        }
      });
    });
  }

  /**
   * The canvasContext string of the chat's bound canvas tab (an unbound chat binds
   * passively to the first registered tab, never opening one). When there is no fresh
   * one (no tab at all; tab gone; error; 2 s
   * timeout; empty) the last one this chat received, or null if it never got one.
   */
  async requestContext(sessionId: string, model: string): Promise<string | null> {
    // A chat that never called a canvas tool still has the document of the first tab.
    if (!this.liveBinding(sessionId)) await this.bindPassively(sessionId);
    const fresh = await this.fetchContext(sessionId, model);
    if (fresh !== null) {
      this.lastContext.set(sessionId, fresh);
      return fresh;
    }
    // A failed request must not make the context flap in and out of the prompt:
    // the last one this chat received stands in (null only if it never got one).
    return this.lastContext.get(sessionId) ?? null;
  }

  private fetchContext(sessionId: string, model: string): Promise<string | null> {
    const binding = this.liveBinding(sessionId);
    if (!binding) return Promise.resolve(null);
    const reqId = `ctx${++this.counter}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<string | null>((resolve) => {
      let done = false;
      const pending: Pending = {
        key: keyOf(binding),
        tab: binding,
        isContext: true,
        settle: (raw) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          this.pending.delete(reqId);
          // `raw` is the context itself; the error paths settle with "".
          resolve(raw === "" ? null : raw);
        },
      };
      const timer = setTimeout(() => pending.settle(""), CONTEXT_TIMEOUT_MS);
      this.pending.set(reqId, pending);
      const envId = this.post(binding.tabId, { kind: "context-request", reqId, sessionId, model });
      this.byEnvelope.set(envId, reqId);
    });
  }

  // ---- incoming ------------------------------------------------------------

  private handle(tabId: number, env: LinkEnvelope<CanvasToChatMsg | MainToChatMsg>): void {
    const msg = env.msg;
    switch (msg.kind) {
      case "result":
        this.pending.get(msg.callId)?.settle(msg.result);
        break;
      case "started":
        this.pending.get(msg.callId)?.onStarted?.();
        break;
      case "launch":
        if (!this.seenLaunches.has(msg.launchId)) {
          this.seenLaunches.add(msg.launchId);
          if (this.seenLaunches.size > MAX_ENDED_STREAMS) this.seenLaunches.delete(this.seenLaunches.values().next().value as string);
          try {
            this.onLaunch?.({ tabId, launchId: msg.launchId, payload: msg.payload });
          } catch {
            // A launch handler must not break the message loop.
          }
        }
        break;
      case "context-response":
        // A genuine empty context is indistinguishable from a failure: both mean "send none".
        this.pending.get(msg.reqId)?.settle(msg.canvasContext);
        break;
      case "resync":
        this.streams.get(msg.toolCallId)?.encoder.forceFull();
        break;
      case "error": {
        const id = this.byEnvelope.get(msg.refId);
        if (!id) break;
        const p = this.pending.get(id);
        // Context requests settle "" (= null); calls get the error as a result.
        if (p) {
          p.settle(p.isContext ? "" : errorResult(msg.error), "main_error");
          // Main could not deliver: if the bound tab is no longer listed, latch it
          // so the next call rebinds instead of failing forever.
          if (p.tab) void this.latchIfUnlisted(p.tab);
        }
        break;
      }
      case "tab-gone":
        this.latchRegistration(tabId, msg.registrationId);
        break;
      default:
        break;
    }
    // Keep the envelope map bounded: entries are only useful while the request is pending.
    if (this.byEnvelope.size > 200) {
      for (const [envId, id] of this.byEnvelope) if (!this.pending.has(id)) this.byEnvelope.delete(envId);
    }
  }

  private async latchIfUnlisted(tab: Binding): Promise<void> {
    let list = this.tabs;
    try {
      list = await this.bridge.listTabs();
      this.tabs = list;
    } catch {
      // Judge by the last known list.
    }
    if (!list.some((t) => t.tabId === tab.tabId && t.registrationId === tab.registrationId)) {
      this.latchRegistration(tab.tabId, tab.registrationId);
    }
  }

  private latchRegistration(tabId: number, registrationId: number): void {
    const key = `${tabId}:${registrationId}`;
    this.latched.add(key);
    // The closed document's context must not be sent to the next turn.
    for (const [sessionId, b] of [...this.bindings]) if (keyOf(b) === key) this.dropBinding(sessionId);
    for (const [toolCallId, s] of [...this.streams]) {
      if (s.binding && keyOf(s.binding) === key) {
        this.streams.delete(toolCallId);
        this.markEnded(toolCallId);
      }
    }
    for (const p of [...this.pending.values()]) {
      if (p.key === key) p.settle(p.isContext ? "" : TAB_CLOSED_ERROR, "tab_gone");
    }
  }
}
