// In-memory stand-in for the main process + canvas tabs, seen from the agent panel.
import { vi } from "vitest";
import { AppendDecoder } from "../appendCodec";
import type {
  AgentPanelCanvasBridge,
  CanvasTabInfo,
  CanvasToChatMsg,
  ChatToCanvasMsg,
  LinkEnvelope,
  MainToChatMsg,
} from "../protocol";

type Incoming = CanvasToChatMsg | MainToChatMsg;
export interface Posted {
  tabId: number;
  env: LinkEnvelope<ChatToCanvasMsg>;
}

export function createFakeCanvasBridge(initialTabs: CanvasTabInfo[] = []) {
  let tabs = [...initialTabs];
  let nextTabId = 100;
  const posted: Posted[] = [];
  const messageListeners = new Set<(tabId: number, env: LinkEnvelope<Incoming>) => void>();
  const tabListeners = new Set<(tabs: CanvasTabInfo[]) => void>();
  let envCounter = 0;
  /** Resolves `openTab()`; null = resolve at once with a new tab. */
  let openGate: Promise<void> | null = null;
  let laggedTabs: CanvasTabInfo[] | null = null;
  const handlers: Array<(p: Posted) => void> = [];

  const fake = {
    posted,
    openTab: vi.fn(async (): Promise<{ tabId: number; registrationId: number }> => {
      await openGate;
      const info = { tabId: nextTabId++, registrationId: 1, title: "Untitled", active: true };
      if (laggedTabs) {
        // The race: `openTab()` resolves before the tab list announces the new tab.
        laggedTabs.push(info);
      } else {
        tabs = [info, ...tabs];
        tabListeners.forEach((cb) => cb(tabs));
      }
      return { tabId: info.tabId, registrationId: info.registrationId };
    }),
    /** Opened tabs show up in the list only after `publishLaggedTabs()`. */
    lagTabAnnouncements() {
      laggedTabs = [];
    },
    publishLaggedTabs() {
      tabs = [...(laggedTabs ?? []), ...tabs];
      laggedTabs = null;
      tabListeners.forEach((cb) => cb(tabs));
    },
    bridge: null as unknown as AgentPanelCanvasBridge,
    /** Hold `openTab()` until the returned function is called. */
    holdOpen(): () => void {
      let release!: () => void;
      openGate = new Promise<void>((r) => (release = r));
      return () => {
        openGate = null;
        release();
      };
    },
    setTabs(next: CanvasTabInfo[]) {
      tabs = next;
      tabListeners.forEach((cb) => cb(tabs));
    },
    get tabs() {
      return tabs;
    },
    /** A message from a tab (or main) to the panel. */
    emit(tabId: number, msg: Incoming) {
      const env = { id: `e${++envCounter}`, sentAt: 0, msg };
      messageListeners.forEach((cb) => cb(tabId, env));
    },
    /** The tab closes: main sends tab-gone and the list shrinks. */
    closeTab(tabId: number) {
      const gone = tabs.find((t) => t.tabId === tabId);
      tabs = tabs.filter((t) => t.tabId !== tabId);
      if (gone) fake.emit(tabId, { kind: "tab-gone", registrationId: gone.registrationId });
      tabListeners.forEach((cb) => cb(tabs));
    },
    /** The tab reloads: tab-gone for the old registration, a new registrationId. */
    reloadTab(tabId: number) {
      const old = tabs.find((t) => t.tabId === tabId)!;
      fake.emit(tabId, { kind: "tab-gone", registrationId: old.registrationId });
      tabs = tabs.map((t) => (t.tabId === tabId ? { ...t, registrationId: t.registrationId + 1 } : t));
      tabListeners.forEach((cb) => cb(tabs));
    },
    /** Reacts to every message the panel posts (the "canvas tab"). */
    onPost(handler: (p: Posted) => void) {
      handlers.push(handler);
    },
    kinds(): string[] {
      return posted.map((p) => p.env.msg.kind);
    },
    ofKind<K extends ChatToCanvasMsg["kind"]>(kind: K) {
      return posted.filter((p) => p.env.msg.kind === kind).map((p) => p.env.msg as Extract<ChatToCanvasMsg, { kind: K }>);
    },
  };

  fake.bridge = {
    listTabs: async () => tabs,
    openTab: fake.openTab,
    activateTab: () => {},
    post(tabId, env) {
      const p = { tabId, env };
      posted.push(p);
      handlers.forEach((h) => h(p));
    },
    onMessage(cb) {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    onTabsChanged(cb) {
      tabListeners.add(cb);
      return () => tabListeners.delete(cb);
    },
  };
  return fake;
}

export type FakeCanvasBridge = ReturnType<typeof createFakeCanvasBridge>;

export const tab = (tabId: number, registrationId = 1): CanvasTabInfo => ({
  tabId,
  registrationId,
  title: `Tab ${tabId}`,
  active: false,
});

/**
 * A scripted canvas tab: decodes streams like the real one, answers `call` with
 * `onCall(...)`, `context-request` with `context`, `place-node` with `onPlace(...)`.
 */
export function attachScriptedCanvas(
  fake: FakeCanvasBridge,
  script: {
    onCall?: (toolName: string, input: unknown) => string;
    context?: string;
    onPlace?: (node: unknown, options: unknown) => string;
  } = {}
) {
  const decoders = new Map<string, AppendDecoder>();
  const inputs: Array<{ toolCallId: string; input: Record<string, unknown> }> = [];
  fake.onPost(({ tabId, env }) => {
    const msg = env.msg;
    if (msg.kind === "stream") {
      let d = decoders.get(msg.toolCallId);
      if (!d) decoders.set(msg.toolCallId, (d = new AppendDecoder()));
      const r = d.apply(msg);
      if (r.status === "input") inputs.push({ toolCallId: msg.toolCallId, input: r.input });
      if (r.status === "resync") queueMicrotask(() => fake.emit(tabId, { kind: "resync", toolCallId: msg.toolCallId }));
    } else if (msg.kind === "call") {
      const result = script.onCall?.(msg.toolName, msg.input) ?? JSON.stringify({ ok: true });
      queueMicrotask(() => {
        fake.emit(tabId, { kind: "started", callId: msg.callId });
        fake.emit(tabId, { kind: "result", callId: msg.callId, result });
      });
    } else if (msg.kind === "context-request" && script.context !== undefined) {
      const canvasContext = script.context;
      queueMicrotask(() => fake.emit(tabId, { kind: "context-response", reqId: msg.reqId, canvasContext }));
    } else if (msg.kind === "place-node") {
      const result = script.onPlace?.(msg.node, msg.options) ?? JSON.stringify({ id: "n1", x: 0, y: 0 });
      queueMicrotask(() => fake.emit(tabId, { kind: "result", callId: msg.callId, result }));
    }
  });
  return { inputs };
}
