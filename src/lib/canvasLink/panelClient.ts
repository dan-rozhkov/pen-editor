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
  type SelectionChipsSnapshot,
} from "./protocol";

/** Added to the per-tool timeout so the canvas tab's own timeout error wins the race. */
export const CALL_TIMEOUT_MARGIN_MS = 2000;
/** Extra wait for a call with a `brief`: the tab's taste check (TASTE_CHECK_TIMEOUT_MS, 8 s) + 1 s. */
export const TASTE_CHECK_MARGIN_MS = 9000;
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
const MAX_LAUNCH_OUTCOMES = 100;

const TAB_CLOSED_ERROR_OBJ = { error: "The canvas tab was closed." };
export const TAB_CLOSED_ERROR = JSON.stringify(TAB_CLOSED_ERROR_OBJ);
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
  /**
   * The model a chat really uses (what `useDesignChat` sends for that session). Used when a context
   * is prefetched at bind time, before the chat has made any request, so the selection hint matches.
   * Default: the model the chat last asked a context with, else "".
   */
  modelFor?: (sessionId: string) => string;
  /** A canvas tab's `launch` (an on-canvas agent entry point). Each `launchId` is delivered once. */
  onLaunch?: (launch: { tabId: number; launchId: string; payload: ChatLaunchMessagePayload }) => void;
  /**
   * A tab closed while this call's tool input was still streaming to it (before `callTool`): the
   * streamed progress is gone, and the call must not run on another tab. Called once per such stream.
   */
  onStreamLost?: (sessionId: string, toolCallId: string) => void;
}

export interface CallOptions {
  toolCallId: string;
  /** The chat side's per-tool budget; the client waits this + 2 s. */
  timeoutMs: number;
  signal?: AbortSignal;
  /** Sent with the call so the tab runs the Jev taste check; adds `TASTE_CHECK_MARGIN_MS` to the wait. */
  brief?: string;
}

type Outgoing = ChatToCanvasMsg;

/** What the one binding path (`establish`) is asked to do. */
interface EstablishSpec {
  /**
   * Return the chat's live binding when it has one. ONLY the implicit bind does this: an explicit
   * bind (`bindExplicit`, `bindTo`) always honors its own target, even when it was queued behind
   * another bind that established a different binding.
   */
  reuseLive: boolean;
  /** Choose a registered tab from the fresh list; undefined = none (open one, if `open`). */
  find?: (tabs: CanvasTabInfo[]) => CanvasTabInfo | undefined;
  /** Open a tab when `find` chose none. */
  open?: { activate: boolean };
  /** Activate the tab that was found or reused. */
  activate?: boolean;
  /** A failing `listTabs()` is judged by the last known list instead of failing. */
  tolerateListFailure?: boolean;
  /**
   * Prefetch the new tab's context (so the request after a switch does not lose its `canvasContext`).
   * `bindTo` leaves it to the caller (`primeSession`), which acks a launch first.
   */
  prime?: boolean;
  /** Checked before anything with a side effect; NOT after `openTab()` resolved (the tab exists then). */
  signal?: AbortSignal;
}

type Established =
  | { ok: true; binding: Binding; opened: boolean }
  | { ok: false; reason: "aborted" | "closed" | "unavailable" | "not_listed" };

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
  private readonly modelFor?: PanelClientDeps["modelFor"];
  private readonly onStreamLost?: PanelClientDeps["onStreamLost"];
  /** Calls whose live stream a closing tab took: `callTool` answers them with the tab-closed error. */
  private readonly lostStreams = new Set<string>();
  /**
   * Per `launchId`: the outcome of its first handling (null = acked ok, string = acked with that error,
   * undefined = still being handled). A repeated launch (a canvas tab's retry) gets the same ack again
   * and is never handled twice. Bounded to `MAX_LAUNCH_OUTCOMES`.
   */
  private readonly launchOutcomes = new Map<string, string | null | undefined>();
  private tabs: CanvasTabInfo[] = [];
  private readonly bindings = new Map<string, Binding>();
  /** Per chat: the tail of the queue of binds in flight (see `establish`). Present = a bind is running. */
  private readonly binding$ = new Map<string, Promise<void>>();
  /** Per chat: whether the last binding was made by opening a tab (reported to a reusing implicit bind). */
  private readonly lastOpened = new Map<string, boolean>();
  /** The model each chat last asked for a context with (used when a context is prefetched). */
  private readonly models = new Map<string, string>();
  private readonly latched = new Set<string>();
  private readonly streams = new Map<string, Stream>();
  /** Calls whose stream is closed: a late frame for one must not reopen it. */
  private readonly ended = new Set<string>();
  private readonly pending = new Map<string, Pending>();
  private readonly byEnvelope = new Map<string, string>();
  /** The last canvasContext each chat received from its tab. */
  private readonly lastContext = new Map<string, string>();
  /** The latest selection-chips snapshot each tab published, by `tabId` (dropped on its `tab-gone`). */
  private readonly selections = new Map<number, { registrationId: number | undefined; snapshot: SelectionChipsSnapshot }>();
  /** Registrations already asked for their selection (`selection-request`). */
  private readonly selectionAsked = new Set<string>();
  /** Envelope id of an in-flight `selection-request` -> its registration key (a main `error` re-arms it). */
  private readonly selectionRequests = new Map<string, string>();
  private watching = false;
  private readonly changeListeners = new Set<() => void>();
  private counter = 0;
  private readonly unsubscribers: Array<() => void>;

  constructor(deps: PanelClientDeps) {
    this.bridge = deps.bridge;
    this.now = deps.now ?? linkNow;
    this.onCallFailed = deps.onCallFailed;
    this.onLaunch = deps.onLaunch;
    this.modelFor = deps.modelFor;
    this.onStreamLost = deps.onStreamLost;
    this.unsubscribers = [
      deps.bridge.onTabsChanged((tabs) => {
        this.tabs = tabs;
        this.requestMissingSelections();
        this.notifyChange();
      }),
      deps.bridge.onMessage((tabId, env) => this.handle(tabId, env)),
    ];
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    for (const p of [...this.pending.values()]) p.settle(errorResult("The agent panel closed."));
    this.streams.clear();
    this.lostStreams.clear();
  }

  /**
   * The selection chips of the tab this chat is bound to; with no live binding the first listed,
   * non-latched tab (the same passive rule as `canvasContext`). Null = no tab, or none published yet.
   * The returned object keeps its identity until the tab publishes a different one.
   */
  selectionFor(sessionId?: string): SelectionChipsSnapshot | null {
    const bound = sessionId ? this.bindings.get(sessionId) : undefined;
    const tab = bound && !this.latched.has(keyOf(bound)) ? bound : this.tabs.find((t) => !this.latched.has(keyOf(t)));
    return (tab && this.selections.get(tab.tabId)?.snapshot) || null;
  }

  /** Fires after any change that can alter `selectionFor` (a snapshot, the tab list, a binding, a tab-gone). */
  subscribe(cb: () => void): () => void {
    this.changeListeners.add(cb);
    this.startWatching();
    return () => this.changeListeners.delete(cb);
  }

  /**
   * Chips are on screen (a subscriber exists): learn the tab list (it has no initial event) and ask the tabs
   * for their selection. Nothing is sent while nobody shows chips.
   */
  private startWatching(): void {
    if (this.watching) return;
    this.watching = true;
    void Promise.resolve(this.bridge.listTabs())
      .then((tabs) => {
        if (this.changeListeners.size === 0) return;
        if (this.tabs.length === 0) this.tabs = tabs;
        this.requestMissingSelections();
        this.notifyChange();
      })
      .catch(() => {});
  }

  private notifyChange(): void {
    for (const cb of [...this.changeListeners]) {
      try {
        cb();
      } catch {
        // A listener must not break the message loop.
      }
    }
  }

  /** Asks each listed registration whose selection we never saw (a panel opened or reloaded after the tab). */
  private requestMissingSelections(): void {
    if (this.changeListeners.size === 0) return;
    for (const t of this.tabs) {
      const key = keyOf(t);
      if (this.latched.has(key) || this.selectionAsked.has(key) || this.selections.has(t.tabId)) continue;
      this.selectionAsked.add(key);
      try {
        const envId = this.postOrThrow(t.tabId, { kind: "selection-request" });
        this.selectionRequests.set(envId, key);
        if (this.selectionRequests.size > 50) this.selectionRequests.delete(this.selectionRequests.keys().next().value as string);
      } catch {
        this.selectionAsked.delete(key); // retried on the next tab-list change
      }
    }
  }

  /** The live binding of a chat, or null. */
  getBinding(sessionId: string): Binding | null {
    return this.bindings.get(sessionId) ?? null;
  }

  /**
   * Looks a tab up in the (refreshed) tab list. Null = not listed or its registration is latched.
   * Binds nothing: lets a caller check a tab before it creates a chat for it.
   */
  async probeTab(tabId: number): Promise<Binding | null> {
    try {
      this.tabs = await this.bridge.listTabs();
    } catch {
      // Judge by the last known list.
    }
    const listed = this.tabs.find((t) => t.tabId === tabId);
    if (!listed) return null;
    const binding = { tabId: listed.tabId, registrationId: listed.registrationId };
    return this.latched.has(keyOf(binding)) ? null : binding;
  }

  /**
   * Binds a chat to a given canvas tab (the sender of a `launch`), replacing any binding. Null =
   * the tab is not listed or its registration is latched, or the resulting binding is not exactly
   * that tab; the chat stays as it was. Does NOT prime the context (`primeSession` does, so a
   * caller can answer first: priming waits up to `CONTEXT_TIMEOUT_MS` on the tab).
   */
  async bindTo(sessionId: string, tabId: number): Promise<Binding | null> {
    const r = await this.establish(sessionId, {
      reuseLive: false,
      find: (tabs) => tabs.find((t) => t.tabId === tabId),
      tolerateListFailure: true,
    });
    return r.ok && r.binding.tabId === tabId ? r.binding : null;
  }

  /** Fills the chat's remembered context from its bound tab (see `primeContext`). Never rejects. */
  async primeSession(sessionId: string): Promise<void> {
    try {
      await this.primeContext(sessionId);
    } catch {
      // The context stays as it was.
    }
  }

  /** Tells a canvas tab its `launch` was handled (no `error`) or refused (`error`). */
  ackLaunch(tabId: number, launchId: string, error?: string): void {
    if (this.launchOutcomes.has(launchId)) this.launchOutcomes.set(launchId, error ? error : null);
    this.post(tabId, { kind: "launch-ack", launchId, ...(error ? { error } : {}) });
  }

  /** Forgets everything remembered about a chat (its binding, not the tab). Call when the chat is deleted. */
  forgetSession(sessionId: string): void {
    this.dropBinding(sessionId);
    this.models.delete(sessionId);
    this.notifyChange();
  }

  /** A binding is gone for good (forgotten or latched): the context of its document goes with it. */
  private dropBinding(sessionId: string): void {
    this.bindings.delete(sessionId);
    this.lastContext.delete(sessionId);
    this.lastOpened.delete(sessionId);
  }

  // ---- sending -------------------------------------------------------------

  private post(tabId: number, msg: Outgoing): string {
    const id = this.nextEnvelopeId();
    try {
      this.bridge.post(tabId, { id, sentAt: this.now(), msg });
    } catch {
      // A throwing bridge must not break the chat; the timeouts report it.
    }
    return id;
  }

  /** Like `post`, but a throwing bridge reaches the caller (a best-effort message that can be retried). */
  private postOrThrow(tabId: number, msg: Outgoing): string {
    const id = this.nextEnvelopeId();
    this.bridge.post(tabId, { id, sentAt: this.now(), msg });
    return id;
  }

  private nextEnvelopeId(): string {
    return `p${++this.counter}-${Math.random().toString(36).slice(2, 8)}`;
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

  /** Resolve per docs/canvas-link.md "Binding"; queued behind any bind of this chat in flight. */
  private async bind(sessionId: string): Promise<Binding | null> {
    if (!this.binding$.has(sessionId)) {
      const live = this.liveBinding(sessionId);
      if (live) return live;
    }
    const r = await this.establish(sessionId, {
      reuseLive: true,
      find: (tabs) => tabs.find((t) => !this.latched.has(keyOf(t))),
      // `openTab()` answers with the registration it waited for (see `establish`).
      open: { activate: false },
    });
    return r.ok ? r.binding : null;
  }

  /**
   * THE binding path: `bind` (implicit), `bindExplicit` and `bindTo` all go through here. Binds of one
   * chat run one after another (`binding$` is the queue), so two concurrent binds never overwrite each
   * other half-way; a queued implicit bind then finds the live binding and reuses it, while an explicit
   * one runs in full (two parallel `open_canvas_tab` "new" open two tabs, as asked). Picks a listed tab (or opens one), checks abort / latch BEFORE any side effect,
   * sets the binding. Never rejects.
   *
   * `openTab()` answers with the registration it waited for: it is never looked up in the tab list,
   * which may not have announced the new tab yet (a guessed registrationId would later read as a
   * reload and latch the tab).
   */
  private establish(sessionId: string, spec: EstablishSpec): Promise<Established> {
    const prev = this.binding$.get(sessionId) ?? Promise.resolve();
    const run = prev.then(() => this.establishNow(sessionId, spec));
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.binding$.set(sessionId, tail);
    void tail.then(() => {
      if (this.binding$.get(sessionId) === tail) this.binding$.delete(sessionId);
    });
    return run;
  }

  private async establishNow(sessionId: string, spec: EstablishSpec): Promise<Established> {
    try {
      if (spec.signal?.aborted) return { ok: false, reason: "aborted" };
      const live = this.liveBinding(sessionId);
      if (live && spec.reuseLive) {
        if (spec.activate) this.bridge.activateTab(live.tabId);
        return { ok: true, binding: live, opened: this.lastOpened.get(sessionId) ?? false };
      }
      try {
        this.tabs = await this.bridge.listTabs();
      } catch (err) {
        if (!spec.tolerateListFailure) throw err;
      }
      let binding: Binding | null = null;
      let opened = false;
      const found = spec.find?.(this.tabs);
      if (found) {
        binding = { tabId: found.tabId, registrationId: found.registrationId };
        if (spec.signal?.aborted) return { ok: false, reason: "aborted" };
        if (this.latched.has(keyOf(binding))) return { ok: false, reason: "closed" };
        if (spec.activate) this.bridge.activateTab(binding.tabId);
      } else if (spec.open) {
        if (spec.signal?.aborted) return { ok: false, reason: "aborted" };
        const made = spec.open.activate ? await this.bridge.openTab({ activate: true }) : await this.bridge.openTab();
        if (!made || typeof made.tabId !== "number" || typeof made.registrationId !== "number") {
          return { ok: false, reason: "unavailable" };
        }
        binding = { tabId: made.tabId, registrationId: made.registrationId };
        opened = true;
        // The tab exists now: bind it even if the call was aborted meanwhile.
        if (this.latched.has(keyOf(binding))) return { ok: false, reason: "closed" };
      } else {
        return { ok: false, reason: "not_listed" };
      }
      const previous = this.bindings.get(sessionId);
      const switched = !previous || keyOf(previous) !== keyOf(binding);
      if (switched) this.lastContext.delete(sessionId);
      this.bindings.set(sessionId, binding);
      this.notifyChange();
      this.lastOpened.set(sessionId, opened);
      if (spec.prime && (switched || !this.lastContext.has(sessionId))) await this.primeContext(sessionId);
      return { ok: true, binding, opened };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  /**
   * Fills `lastContext` from the freshly bound tab (up to `CONTEXT_TIMEOUT_MS`). On failure it holds
   * `{}` (an empty scene), NOT nothing: a chat that has a tab keeps sending a `canvasContext` field, so the
   * system prompt (the pointer block) does not flip because of a slow tab. The old tab's context is
   * never kept: its ids do not exist in the new document.
   */
  private async primeContext(sessionId: string): Promise<void> {
    const fresh = await this.fetchContext(sessionId, this.modelFor?.(sessionId) ?? this.models.get(sessionId) ?? "");
    if (!this.liveBinding(sessionId)) return; // latched meanwhile: its context goes with it
    this.lastContext.set(sessionId, fresh ?? "{}");
  }

  /**
   * Binds a chat to the first registered canvas tab WITHOUT opening one, so the
   * first message of a chat can carry that tab's `canvasContext`. No tab: stays unbound.
   */
  private async bindPassively(sessionId: string): Promise<void> {
    if (this.binding$.has(sessionId)) return; // a bind is running (maybe opening a tab)
    try {
      const listed = await this.bridge.listTabs();
      this.tabs = listed;
      if (this.liveBinding(sessionId) || this.binding$.has(sessionId)) return;
      const usable = listed.find((t) => !this.latched.has(keyOf(t)));
      if (usable) {
        this.bindings.set(sessionId, { tabId: usable.tabId, registrationId: usable.registrationId });
        this.notifyChange();
      }
    } catch {
      // Stays unbound.
    }
  }

  /**
   * Explicit (model-requested) binding, for `open_canvas_tab`. "current": the first usable
   * listed tab (most recently active), opened if there is none, and activated. "new": a freshly
   * opened, activated tab. The chat's previous tab is released WITHOUT latching it (other chats may
   * still use it); its context goes and the new tab's is prefetched. Concurrent binds of the chat are
   * serialized, never merged: "new" always opens its own tab (see `establish`). An abort stops the call before it opens or activates
   * anything; once the tab was opened it is bound and reported as a success. Never rejects.
   */
  async bindExplicit(
    sessionId: string,
    target: "new" | "current",
    signal?: AbortSignal
  ): Promise<{ tabId: number; title: string; opened: boolean } | { error: string }> {
    const r = await this.establish(sessionId, {
      reuseLive: false,
      find: target === "current" ? (tabs) => tabs.find((t) => !this.latched.has(keyOf(t))) : undefined,
      open: { activate: true },
      activate: true,
      prime: true,
      signal,
    });
    if (!r.ok) {
      if (r.reason === "aborted") return { error: "Tool call aborted" };
      return r.reason === "closed" ? TAB_CLOSED_ERROR_OBJ : { error: "Could not open a canvas tab." };
    }
    const { binding, opened } = r;
    let title = this.tabs.find((t) => t.tabId === binding.tabId)?.title;
    if (title === undefined) {
      try {
        this.tabs = await this.bridge.listTabs();
        title = this.tabs.find((t) => t.tabId === binding.tabId)?.title;
      } catch {
        // Keep the fallback.
      }
    }
    return { tabId: binding.tabId, title: title ?? "Untitled", opened };
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
    const { toolCallId, timeoutMs, signal, brief } = options;
    // The tab that held this call's streamed progress closed: never run it on another tab.
    if (this.lostStreams.delete(toolCallId)) return Promise.resolve(TAB_CLOSED_ERROR);
    // Close the stream first; if its frames still wait for the tab, flush them before the call.
    const stream = this.streams.get(toolCallId);
    this.endStream(toolCallId, "complete");
    return this.request({
      callId: toolCallId,
      sessionId,
      toolName,
      timeoutMs: timeoutMs + CALL_TIMEOUT_MARGIN_MS + (brief ? TASTE_CHECK_MARGIN_MS : 0),
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
        return this.post(binding.tabId, { kind: "call", callId, toolName, input, timeoutMs, ...(brief ? { brief } : {}) });
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
    this.models.set(sessionId, model);
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
        if (this.launchOutcomes.has(msg.launchId)) {
          // A retry of a launch already handled (or being handled): repeat its ack, never handle it again.
          const outcome = this.launchOutcomes.get(msg.launchId);
          if (outcome !== undefined) this.ackLaunch(tabId, msg.launchId, outcome ?? undefined);
        } else {
          this.launchOutcomes.set(msg.launchId, undefined);
          if (this.launchOutcomes.size > MAX_LAUNCH_OUTCOMES) {
            this.launchOutcomes.delete(this.launchOutcomes.keys().next().value as string);
          }
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
        const askedKey = this.selectionRequests.get(msg.refId);
        if (askedKey !== undefined) {
          // Main could not deliver our selection-request: ask again on the next tab-list change.
          this.selectionRequests.delete(msg.refId);
          this.selectionAsked.delete(askedKey);
        }
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
      case "selection":
        this.selections.set(tabId, {
          registrationId: this.tabs.find((t) => t.tabId === tabId)?.registrationId,
          snapshot: msg.selection,
        });
        this.notifyChange();
        break;
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
    // Drop the snapshot unless it is known to come from a NEWER registration (the tab list already
    // shows one). If the list is stale the snapshot goes too, and the new registration is asked again
    // once the list catches up (`requestMissingSelections`), so the chips recover either way.
    const held = this.selections.get(tabId);
    if (held && (held.registrationId === undefined || held.registrationId <= registrationId)) {
      this.selections.delete(tabId);
    }
    // The closed document's context must not be sent to the next turn.
    for (const [sessionId, b] of [...this.bindings]) if (keyOf(b) === key) this.dropBinding(sessionId);
    const lost: Array<[string, string]> = [];
    for (const [toolCallId, s] of [...this.streams]) {
      if (s.binding && keyOf(s.binding) === key) {
        this.streams.delete(toolCallId);
        this.markEnded(toolCallId);
        this.lostStreams.add(toolCallId);
        if (this.lostStreams.size > MAX_ENDED_STREAMS) this.lostStreams.delete(this.lostStreams.values().next().value as string);
        lost.push([s.sessionId, toolCallId]);
      }
    }
    for (const p of [...this.pending.values()]) {
      if (p.key === key) p.settle(p.isContext ? "" : TAB_CLOSED_ERROR, "tab_gone");
    }
    for (const [sessionId, toolCallId] of lost) {
      try {
        this.onStreamLost?.(sessionId, toolCallId);
      } catch {
        // An observer must not break the latch.
      }
    }
    this.requestMissingSelections();
    this.notifyChange();
  }
}
