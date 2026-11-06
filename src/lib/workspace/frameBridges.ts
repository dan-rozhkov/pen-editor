// Frame side of the canvas link in the browser shell: the same two bridge shapes the Electron
// preloads expose (`window.penAgentPanel`, `window.penDesktop.canvasHost`), built on
// `window.postMessage` to the `/workspace` page, which routes (shellRouter.ts). Every message
// is sent with our own origin as target, and a received one counts only when its origin is ours
// and its source is the parent window.

import type { PenAgentPanelApi } from "@/lib/agentPanel";
import type { AgentPanelCanvasBridge, CanvasHostBridge, CanvasTabInfo } from "@/lib/canvasLink/protocol";
import {
  isWireMessage,
  wire,
  type FrameToShell,
  type ItemRef,
  type ShellToPanel,
  type ShellToTab,
} from "./linkWire";

function postToShell(msg: FrameToShell): void {
  window.parent.postMessage(wire(msg), window.location.origin);
}

/** The shell's message in `event`, or null when it is not from our parent window, our origin, or our wire. */
export function acceptShellMessage(event: MessageEvent): ({ type: string } & Record<string, unknown>) | null {
  if (event.origin !== window.location.origin || event.source !== window.parent) return null;
  return isWireMessage(event.data) ? (event.data as { type: string } & Record<string, unknown>) : null;
}

/** Cap on from-tab messages held for a chat that never subscribes (see the eviction rule in the handler). */
const MAX_EARLY_MESSAGES = 500;

function safely(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn("[canvasLink] listener failed", err);
  }
}

/** Canvas tab side: `register` once, then relay envelopes. `bye` goes out when the page unloads. */
export function createWorkspaceCanvasHostBridge(): CanvasHostBridge {
  const listeners = new Set<(env: ShellToTab["env"]) => void>();
  let registered = false;
  let listening = false;

  const onMessage = (event: MessageEvent) => {
    const msg = acceptShellMessage(event);
    if (!msg || msg.type !== "from-panel") return;
    const env = msg.env as ShellToTab["env"];
    for (const cb of [...listeners]) safely(() => cb(env));
  };
  const onPageHide = (event: Event) => {
    // A page kept in the back/forward cache stays alive and registered: it is not gone.
    if (!registered || (event as PageTransitionEvent).persisted) return;
    registered = false;
    postToShell({ type: "bye" });
  };
  const updateListening = () => {
    const want = listeners.size > 0 || registered;
    if (want && !listening) window.addEventListener("message", onMessage);
    else if (!want && listening) window.removeEventListener("message", onMessage);
    listening = want;
  };

  return {
    register() {
      if (!registered) window.addEventListener("pagehide", onPageHide);
      registered = true;
      updateListening();
      postToShell({ type: "register" });
    },
    unregister() {
      if (!registered) return;
      registered = false;
      window.removeEventListener("pagehide", onPageHide);
      updateListening();
      postToShell({ type: "unregister" });
    },
    post(env) {
      postToShell({ type: "to-panel", env });
    },
    onMessage(cb) {
      listeners.add(cb);
      updateListening();
      return () => {
        listeners.delete(cb);
        updateListening();
      };
    },
  };
}

/**
 * Agent panel side: canvas link, plus the Settings, document and workflow tab openers. No disk
 * functions (the mirrors need all of them, so they stay off on the web), no chats, browser,
 * traces or auth. Listens from creation on and announces itself (`hello`) so the shell can tell
 * a reloaded panel from the first one.
 */
export function createWorkspacePanelApi(): PenAgentPanelApi {
  const replies = new Map<string, (msg: ShellToPanel) => void>();
  const tabListeners = new Set<(tabs: CanvasTabInfo[]) => void>();
  type FromTabCb = (tabId: number, env: Extract<ShellToPanel, { type: "from-tab" }>["env"]) => void;
  const messageListeners = new Set<FromTabCb>();
  // The shell may push before the chat subscribes (the panel client starts after the page mounts):
  // hold from-tab messages for the first listener, in order, and the last tab list for the first
  // tabs listener.
  let early: Array<[number, Parameters<FromTabCb>[1]]> | null = [];
  let lastTabs: CanvasTabInfo[] | null = null;
  let tabsReplayed = false;
  let flushScheduled = false;
  let counter = 0;
  // Unique per panel load: a reply meant for a previous load can never match a request of this one.
  const ridPrefix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  window.addEventListener("message", (event) => {
    const msg = acceptShellMessage(event) as ShellToPanel | null;
    if (!msg) return;
    switch (msg.type) {
      case "list-reply":
      case "open-reply":
      case "item-reply": {
        const settle = replies.get(msg.rid);
        if (!settle) return;
        replies.delete(msg.rid);
        settle(msg);
        return;
      }
      case "tabs":
        lastTabs = msg.tabs;
        for (const cb of [...tabListeners]) safely(() => cb(msg.tabs));
        return;
      case "from-tab":
        if (early) {
          if (early.length >= MAX_EARLY_MESSAGES) {
            // Over the cap only a `selection` (a display-only snapshot) may go, the oldest first. A
            // `tab-gone` or `launch` is never dropped, so the buffer may then grow past the cap.
            const oldest = early.findIndex(([, e]) => e.msg.kind === "selection");
            if (oldest !== -1) early.splice(oldest, 1);
          }
          early.push([msg.tabId, msg.env]);
          return;
        }
        for (const cb of [...messageListeners]) safely(() => cb(msg.tabId, msg.env));
        return;
    }
  });

  function request(build: (rid: string) => FrameToShell): Promise<ShellToPanel> {
    const rid = `${ridPrefix}-${++counter}`;
    return new Promise((resolve) => {
      replies.set(rid, resolve);
      postToShell(build(rid));
    });
  }

  const openItem = async (item: ItemRef): Promise<{ ok: boolean; error?: string }> => {
    const reply = await request((rid) => ({ type: "open-item", rid, item }));
    return reply.type === "item-reply" ? { ok: reply.ok, ...(reply.error ? { error: reply.error } : {}) } : { ok: false };
  };

  const canvas: AgentPanelCanvasBridge = {
    async listTabs() {
      const reply = await request((rid) => ({ type: "list", rid }));
      return reply.type === "list-reply" ? reply.tabs : [];
    },
    // `activate` follows the shell's rule (linkWire.ts, "open"): true always makes a new tab, otherwise an
    // unregistered canvas tab in the strip is woken and used first.
    async openTab(opts) {
      const reply = await request((rid) => ({ type: "open", rid, ...(opts?.activate ? { activate: true } : {}) }));
      if (reply.type !== "open-reply") throw new Error("Unexpected reply.");
      if (!reply.ok) throw new Error(reply.error);
      return { tabId: reply.tabId, registrationId: reply.registrationId };
    },
    activateTab(tabId) {
      postToShell({ type: "activate", tabId });
    },
    post(tabId, env) {
      postToShell({ type: "to-tab", tabId, env });
    },
    onMessage(cb) {
      messageListeners.add(cb);
      if (early && !flushScheduled) {
        flushScheduled = true;
        // Not inside this call: the caller (the PanelClient constructor) has not finished yet, so what a
        // replayed `launch` triggers would still find no client. Live messages keep queueing until then.
        queueMicrotask(() => {
          const held = early ?? [];
          early = null;
          if (!messageListeners.has(cb)) return;
          for (const [tabId, env] of held) safely(() => cb(tabId, env));
        });
      }
      return () => messageListeners.delete(cb);
    },
    onTabsChanged(cb) {
      tabListeners.add(cb);
      if (!tabsReplayed) {
        tabsReplayed = true;
        queueMicrotask(() => {
          if (lastTabs && tabListeners.has(cb)) safely(() => cb(lastTabs!));
        });
      }
      return () => tabListeners.delete(cb);
    },
  };

  postToShell({ type: "hello" });

  return {
    version: 2,
    canvas,
    settings: { open: (section) => openItem({ kind: "settings", ...(section ? { section } : {}) }) },
    docs: { open: (id) => openItem({ kind: "doc", id }) },
    workflows: { open: (id) => openItem({ kind: "workflow", id }) },
  };
}
