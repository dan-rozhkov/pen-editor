// The browser shell's canvas-link router: the web counterpart of the desktop main process
// (pen-editor-desktop `src/main/canvasLink.ts`, docs/canvas-link.md "Main process"). It relays
// envelopes between the one agent panel frame and the registered canvas tab frames, and never
// reads a tool payload. Pure and DOM-free: WorkspacePage injects the sends and the tab actions,
// and works out the sender of each message from `event.source` (the role of Electron's `e.sender`).

import type { CanvasTabInfo, CanvasToChatMsg, ChatToCanvasMsg, LinkEnvelope, MainToChatMsg } from "@/lib/canvasLink/protocol";
import { isWireMessage, type ItemRef, type ShellToPanel, type ShellToTab } from "./linkWire";
import type { TabKind } from "./tabsModel";

export type LinkSender = { from: "panel" } | { from: "tab"; tabId: string; kind: TabKind };

/** A workspace tab as the shell knows it. */
export interface ShellTabInfo {
  id: string;
  kind: TabKind;
  title: string;
}

export interface TimerApi {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ItemResult {
  ok: boolean;
  error?: string;
}

export interface ShellRouterDeps {
  postToPanel(msg: ShellToPanel): void;
  postToTab(tabId: string, msg: ShellToTab): void;
  /** Opens a new canvas tab and returns its string tab id. The shell mounts its frame and brings it forward at once. */
  openCanvasTab(): string;
  /** Mounts the frame of an existing canvas tab and brings the tab forward (no keyboard focus). */
  wakeTab(tabId: string): void;
  activateTab(tabId: string): void;
  openDoc(docId: string): ItemResult;
  openWorkflow(workflowId: string): ItemResult;
  openSettings(section?: string): ItemResult;
  now(): number;
  timers?: TimerApi;
}

/** Kinds only the router may produce; a frame posting them is dropped. */
const MAIN_ONLY_KINDS = new Set(["error", "tab-gone", "panel-gone"]);

/** An `open` is answered when the new tab registers, else with an error after this. */
export const OPEN_TIMEOUT_MS = 20_000;

export const ERR_OPEN_TIMEOUT = "The canvas tab did not register in time.";
export const ERR_OPEN_CLOSED = "The canvas tab was closed before it registered.";

function isEnvelope(value: unknown): value is LinkEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { id?: unknown; sentAt?: unknown; msg?: unknown };
  if (typeof v.id !== "string" || typeof v.sentAt !== "number" || !Number.isFinite(v.sentAt)) return false;
  return typeof v.msg === "object" && v.msg !== null && typeof (v.msg as { kind?: unknown }).kind === "string";
}

function parseItem(value: unknown): ItemRef | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as { kind?: unknown; id?: unknown; section?: unknown };
  if ((v.kind === "doc" || v.kind === "workflow") && typeof v.id === "string") return { kind: v.kind, id: v.id };
  if (v.kind === "settings" && (v.section === undefined || typeof v.section === "string")) {
    return { kind: "settings", ...(v.section !== undefined ? { section: v.section } : {}) };
  }
  return null;
}

interface Registered {
  registrationId: number;
  /** Order tiebreak for tabs that were never activated. */
  registeredSeq: number;
}

interface PendingOpen {
  rid: string;
  timer: unknown;
  /** Waits for a woken (existing) tab: on timeout the request falls back to a new tab. */
  waking: boolean;
}

export class ShellRouter {
  private readonly numById = new Map<string, number>();
  private readonly idByNum = new Map<number, string>();
  private nextNum = 1;
  private readonly registered = new Map<string, Registered>();
  /** Per tab, kept across re-registers so a reloaded tab gets a new id. */
  private readonly registrationCounter = new Map<string, number>();
  private readonly activationSeq = new Map<string, number>();
  /** Per tab: every `open` waiting for its registration (parallel opens share one tab). */
  private readonly pendingOpen = new Map<string, PendingOpen[]>();
  /** Canvas tabs in strip order, from the last sync. */
  private canvasOrder: string[] = [];
  /** Woken tabs that did not register in time: never woken again until they register. */
  private readonly failedWake = new Set<string>();
  private titles = new Map<string, string>();
  private known = new Set<string>();
  private activeCanvas: string | null = null;
  private seq = 0;
  private nextMainId = 1;
  private helloSeen = false;
  private lastPushed: string | null = "[]";
  private lastSyncKey = "";
  private readonly timers: TimerApi;
  private readonly deps: ShellRouterDeps;

  constructor(deps: ShellRouterDeps) {
    this.deps = deps;
    this.timers = deps.timers ?? {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
  }

  /** The registered canvas tabs, most recently active first. */
  listTabs(): CanvasTabInfo[] {
    return [...this.registered.entries()]
      .sort(([a, ra], [b, rb]) => {
        const sa = this.activationSeq.get(a) ?? 0;
        const sb = this.activationSeq.get(b) ?? 0;
        return sb - sa || rb.registeredSeq - ra.registeredSeq;
      })
      .map(([id, r]) => ({
        tabId: this.numFor(id),
        registrationId: r.registrationId,
        title: this.titles.get(id) ?? "Untitled",
        active: id === this.activeCanvas,
      }));
  }

  /**
   * The shell's tab list or active tab changed. `activeTabId` is the active workspace tab (any
   * kind); a doc or settings tab in front leaves the activation order as it was.
   */
  syncTabs(tabs: ShellTabInfo[], activeTabId: string | null): void {
    const key = `${activeTabId}|${tabs.map((t) => `${t.id}:${t.kind}:${t.title}`).join("\u0000")}`;
    if (key === this.lastSyncKey) return;
    this.lastSyncKey = key;
    this.titles = new Map(tabs.map((t) => [t.id, t.title]));
    const active = tabs.find((t) => t.id === activeTabId);
    const activeCanvas = active?.kind === "canvas" ? active.id : null;
    if (activeCanvas !== null && activeCanvas !== this.activeCanvas) this.activationSeq.set(activeCanvas, ++this.seq);
    this.activeCanvas = activeCanvas;
    const live = new Set(tabs.map((t) => t.id));
    for (const id of [...this.registered.keys()]) if (!live.has(id)) this.drop(id);
    for (const [id, list] of [...this.pendingOpen]) {
      // Only a tab this router has seen in a list can have left it (the open may precede the first sync).
      if (live.has(id) || !this.known.has(id)) continue;
      this.pendingOpen.delete(id);
      for (const p of list) {
        this.timers.clear(p.timer);
        this.deps.postToPanel({ type: "open-reply", rid: p.rid, ok: false, error: ERR_OPEN_CLOSED });
      }
    }
    for (const id of this.known) {
      if (live.has(id)) continue;
      this.activationSeq.delete(id);
      this.registrationCounter.delete(id);
      this.failedWake.delete(id);
      const n = this.numById.get(id);
      if (n !== undefined) this.idByNum.delete(n);
      this.numById.delete(id);
    }
    this.known = live;
    this.canvasOrder = tabs.filter((t) => t.kind === "canvas").map((t) => t.id);
    this.pushTabs();
  }

  /** One message from a frame. `sender` was resolved from `event.source`; `msg` is untrusted. */
  handle(sender: LinkSender, msg: unknown): void {
    if (!isWireMessage(msg)) return;
    if (sender.from === "panel") this.fromPanel(msg);
    else this.fromTab(sender, msg);
  }

  /** Window closed: drop everything without notifying. */
  dispose(): void {
    this.clearPending();
    this.registered.clear();
  }

  private fromPanel(msg: { type: string } & Record<string, unknown>): void {
    switch (msg.type) {
      case "hello": {
        // A second hello is a reloaded panel: whatever the old one left behind is orphaned.
        // Its pending opens belong to the old panel: no reply, and no late timeout error for the new one.
        if (this.helloSeen) {
          this.clearPending();
          this.panelGone();
        }
        this.helloSeen = true;
        this.lastPushed = null;
        this.pushTabs();
        return;
      }
      case "list": {
        if (typeof msg.rid !== "string") return;
        const tabs = this.listTabs();
        this.lastPushed = JSON.stringify(tabs); // the panel now knows this list
        this.deps.postToPanel({ type: "list-reply", rid: msg.rid, tabs });
        return;
      }
      case "open": {
        if (typeof msg.rid !== "string") return;
        // `activate: true` (the chat's open_canvas_tab) always makes a new tab. Otherwise (an implicit bind) a
        // canvas tab that is in the strip but has no registration (restored, or still loading) is woken and used;
        // a blank canvas is made only when there is none.
        const waking = msg.activate === true ? undefined : this.wakeCandidate();
        const id = waking ?? this.deps.openCanvasTab();
        if (waking !== undefined) this.deps.wakeTab(waking);
        this.numFor(id);
        this.armOpen(id, msg.rid, waking !== undefined);
        return;
      }
      case "activate": {
        const id = typeof msg.tabId === "number" ? this.idByNum.get(msg.tabId) : undefined;
        if (id !== undefined && this.registered.has(id)) this.deps.activateTab(id);
        return;
      }
      case "to-tab": {
        const { tabId, env } = msg;
        if (typeof tabId !== "number" || !isEnvelope(env) || MAIN_ONLY_KINDS.has(env.msg.kind)) return;
        const id = this.idByNum.get(tabId);
        if (id === undefined || !this.registered.has(id)) {
          this.deps.postToPanel({
            type: "from-tab",
            tabId,
            env: this.mainEnvelope({ kind: "error", refId: env.id, error: `No canvas tab ${tabId} is registered.` }),
          });
          return;
        }
        this.deps.postToTab(id, { type: "from-panel", env: env as LinkEnvelope<ChatToCanvasMsg> });
        return;
      }
      case "open-item": {
        if (typeof msg.rid !== "string") return;
        const item = parseItem(msg.item);
        let result: ItemResult;
        try {
          if (!item) result = { ok: false, error: "Unknown item." };
          else if (item.kind === "doc") result = this.deps.openDoc(item.id);
          else if (item.kind === "workflow") result = this.deps.openWorkflow(item.id);
          else result = this.deps.openSettings(item.section);
        } catch (error) {
          result = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        this.deps.postToPanel({
          type: "item-reply",
          rid: msg.rid,
          ok: result.ok,
          ...(result.error ? { error: result.error } : {}),
        });
        return;
      }
    }
  }

  private fromTab(sender: { tabId: string; kind: TabKind }, msg: { type: string } & Record<string, unknown>): void {
    const id = sender.tabId;
    switch (msg.type) {
      case "register": {
        if (sender.kind !== "canvas") return;
        const previous = this.registered.get(id);
        if (previous) this.sendMainToPanel(id, { kind: "tab-gone", registrationId: previous.registrationId });
        const registrationId = (this.registrationCounter.get(id) ?? 0) + 1;
        this.registrationCounter.set(id, registrationId);
        this.registered.set(id, { registrationId, registeredSeq: ++this.seq });
        this.failedWake.delete(id);
        const pending = this.pendingOpen.get(id);
        if (pending) {
          this.pendingOpen.delete(id);
          for (const p of pending) {
            this.timers.clear(p.timer);
            this.deps.postToPanel({ type: "open-reply", rid: p.rid, ok: true, tabId: this.numFor(id), registrationId });
          }
        }
        this.pushTabs();
        return;
      }
      case "unregister":
      case "bye":
        this.drop(id);
        return;
      case "to-panel": {
        if (!this.registered.has(id) || !isEnvelope(msg.env) || MAIN_ONLY_KINDS.has(msg.env.msg.kind)) return;
        this.deps.postToPanel({ type: "from-tab", tabId: this.numFor(id), env: msg.env as LinkEnvelope<CanvasToChatMsg> });
        return;
      }
    }
  }

  /** Starts the wait for `id`'s registration. A woken tab that stays silent is marked failed and the request falls back once to a new tab. */
  private armOpen(id: string, rid: string, waking: boolean): void {
    const entry: PendingOpen = { rid, timer: undefined, waking };
    entry.timer = this.timers.set(() => {
      const rest = (this.pendingOpen.get(id) ?? []).filter((p) => p !== entry);
      if (rest.length > 0) this.pendingOpen.set(id, rest);
      else this.pendingOpen.delete(id);
      if (!waking) {
        this.deps.postToPanel({ type: "open-reply", rid, ok: false, error: ERR_OPEN_TIMEOUT });
        return;
      }
      this.failedWake.add(id);
      // Join a fallback tab another request already made, else make one (a new 20 s wait).
      const shared = [...this.pendingOpen].find(([k, list]) => !this.failedWake.has(k) && list.some((p) => !p.waking))?.[0];
      const next = shared ?? this.deps.openCanvasTab();
      this.numFor(next);
      this.armOpen(next, rid, false);
    }, OPEN_TIMEOUT_MS);
    this.pendingOpen.set(id, [...(this.pendingOpen.get(id) ?? []), entry]);
  }

  /** The canvas tab an implicit `open` should use: unregistered, most recently active (a pending new tab counts). */
  private wakeCandidate(): string | undefined {
    const ids = [...this.canvasOrder];
    for (const id of this.pendingOpen.keys()) if (!ids.includes(id)) ids.push(id);
    let best: string | undefined;
    let bestSeq = -1;
    // Later in the strip wins a tie (never-activated tabs).
    for (const id of ids) {
      if (this.registered.has(id) || this.failedWake.has(id)) continue;
      const seq = this.activationSeq.get(id) ?? 0;
      if (seq >= bestSeq) {
        best = id;
        bestSeq = seq;
      }
    }
    return best;
  }

  private clearPending(): void {
    for (const list of this.pendingOpen.values()) for (const p of list) this.timers.clear(p.timer);
    this.pendingOpen.clear();
  }

  /** Tells every registered tab that the panel reloaded, so each aborts what the old panel left running. */
  private panelGone(): void {
    for (const id of this.registered.keys()) {
      this.deps.postToTab(id, { type: "from-panel", env: this.mainEnvelope({ kind: "panel-gone" }) });
    }
  }

  private drop(id: string): void {
    const reg = this.registered.get(id);
    if (!reg) return;
    this.registered.delete(id);
    this.sendMainToPanel(id, { kind: "tab-gone", registrationId: reg.registrationId });
    this.pushTabs();
  }

  private numFor(id: string): number {
    let n = this.numById.get(id);
    if (n === undefined) {
      n = this.nextNum++;
      this.numById.set(id, n);
      this.idByNum.set(n, id);
    }
    return n;
  }

  private pushTabs(): void {
    const tabs = this.listTabs();
    const serialized = JSON.stringify(tabs);
    if (serialized === this.lastPushed) return;
    this.lastPushed = serialized;
    this.deps.postToPanel({ type: "tabs", tabs });
  }

  private mainEnvelope<M extends { kind: string }>(msg: M): { id: string; sentAt: number; msg: M } {
    return { id: `main-${this.nextMainId++}`, sentAt: this.deps.now(), msg };
  }

  /** A router-made message about a tab, delivered to the panel as if from it. */
  private sendMainToPanel(id: string, msg: MainToChatMsg): void {
    this.deps.postToPanel({ type: "from-tab", tabId: this.numFor(id), env: this.mainEnvelope(msg) });
  }
}
