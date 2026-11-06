import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LINK_WIRE_NS, wire } from "../linkWire";
import { acceptShellMessage, createWorkspaceCanvasHostBridge, createWorkspacePanelApi } from "../frameBridges";

const realParent = Object.getOwnPropertyDescriptor(window, "parent");
let parent: { postMessage: ReturnType<typeof vi.fn>; location: { origin: string; pathname: string } };

beforeEach(() => {
  parent = { postMessage: vi.fn(), location: { origin: window.location.origin, pathname: "/workspace" } };
  Object.defineProperty(window, "parent", { configurable: true, value: parent });
});
afterEach(() => {
  if (realParent) Object.defineProperty(window, "parent", realParent);
});

function deliver(data: unknown, opts: { origin?: string; source?: unknown } = {}): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: opts.origin ?? window.location.origin,
      source: ("source" in opts ? opts.source : parent) as MessageEventSource | null,
    }),
  );
}

describe("acceptShellMessage", () => {
  const ev = (init: MessageEventInit) => new MessageEvent("message", init);
  it("accepts our origin, the parent window and our tag", () => {
    const data = wire({ type: "tabs", tabs: [] });
    expect(acceptShellMessage(ev({ data, origin: window.location.origin, source: parent as never }))).toEqual(data);
  });
  it("rejects a foreign origin, a foreign source and untagged data", () => {
    const data = wire({ type: "tabs", tabs: [] });
    expect(acceptShellMessage(ev({ data, origin: "https://evil.example", source: parent as never }))).toBeNull();
    expect(acceptShellMessage(ev({ data, origin: window.location.origin, source: window as never }))).toBeNull();
    expect(acceptShellMessage(ev({ data: { type: "tabs" }, origin: window.location.origin, source: parent as never }))).toBeNull();
  });
});

describe("canvas host bridge", () => {
  it("posts register, to-panel and bye to the parent with our own origin as target", () => {
    const bridge = createWorkspaceCanvasHostBridge();
    bridge.register();
    bridge.post({ id: "e", sentAt: 1, msg: { kind: "started", callId: "c" } });
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide")); // only once
    const calls = parent.postMessage.mock.calls;
    expect(calls.map((c) => (c[0] as { type: string }).type)).toEqual(["register", "to-panel", "bye"]);
    for (const c of calls) {
      expect(c[1]).toBe(window.location.origin);
      expect((c[0] as { ns: string }).ns).toBe(LINK_WIRE_NS);
    }
  });

  it("delivers from-panel envelopes only from the parent window on our origin", () => {
    const bridge = createWorkspaceCanvasHostBridge();
    const cb = vi.fn();
    const off = bridge.onMessage(cb);
    const msg = wire({ type: "from-panel", env: { id: "x", sentAt: 1, msg: { kind: "panel-gone" } } });
    deliver(msg, { origin: "https://evil.example" });
    deliver(msg, { source: window });
    deliver({ ...msg, ns: "other" });
    expect(cb).not.toHaveBeenCalled();
    deliver(msg);
    expect(cb).toHaveBeenCalledWith(msg.env);
    off();
    deliver(msg);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("keeps the registration when the page goes into the back/forward cache", () => {
    const bridge = createWorkspaceCanvasHostBridge();
    bridge.register();
    window.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: true }));
    expect(parent.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(["register"]);
    window.dispatchEvent(new Event("pagehide"));
    expect(parent.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(["register", "bye"]);
  });

  it("unregister posts once and stops the pagehide bye", () => {
    const bridge = createWorkspaceCanvasHostBridge();
    bridge.register();
    bridge.unregister();
    bridge.unregister();
    window.dispatchEvent(new Event("pagehide"));
    expect(parent.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(["register", "unregister"]);
  });
});

describe("panel api", () => {
  it("announces itself and exposes only the web subset", () => {
    const api = createWorkspacePanelApi();
    expect((parent.postMessage.mock.calls[0][0] as { type: string }).type).toBe("hello");
    expect(api.version).toBe(2);
    expect(api.canvas && api.settings?.open && api.docs?.open && api.workflows?.open).toBeTruthy();
    expect(api.docs?.list).toBeUndefined();
    expect(api.workflows?.save).toBeUndefined();
    expect(api.chats).toBeUndefined();
    expect(api.browser).toBeUndefined();
    expect(api.traces).toBeUndefined();
    expect(api.auth).toBeUndefined();
  });

  it("resolves a request with the reply that carries its id, and only from the shell", async () => {
    const api = createWorkspacePanelApi();
    const pending = api.canvas!.listTabs();
    const sent = parent.postMessage.mock.calls.at(-1)![0] as { type: string; rid: string };
    expect(sent.type).toBe("list");
    const tabs = [{ tabId: 1, registrationId: 1, title: "A", active: true }];
    deliver(wire({ type: "list-reply", rid: sent.rid, tabs }), { origin: "https://evil.example" });
    deliver(wire({ type: "list-reply", rid: sent.rid, tabs }), { source: window });
    deliver(wire({ type: "list-reply", rid: sent.rid, tabs }));
    await expect(pending).resolves.toEqual(tabs);
  });

  it("rejects openTab on an error reply and relays pushes and from-tab envelopes", async () => {
    const api = createWorkspacePanelApi();
    const opening = api.canvas!.openTab({ activate: true });
    const sent = parent.postMessage.mock.calls.at(-1)![0] as { rid: string; activate?: boolean };
    expect(sent.activate).toBe(true);
    deliver(wire({ type: "open-reply", rid: sent.rid, ok: false, error: "timeout" }));
    await expect(opening).rejects.toThrow("timeout");

    const onTabs = vi.fn();
    const onMsg = vi.fn();
    api.canvas!.onTabsChanged(onTabs);
    api.canvas!.onMessage(onMsg);
    deliver(wire({ type: "tabs", tabs: [] }));
    const env = { id: "e", sentAt: 1, msg: { kind: "started", callId: "c" } };
    deliver(wire({ type: "from-tab", tabId: 3, env }));
    await Promise.resolve(); // the first listener's replay slot
    expect(onTabs).toHaveBeenCalledWith([]);
    expect(onMsg).toHaveBeenCalledWith(3, env);
  });

  it("openers send open-item and resolve with the reply", async () => {
    const api = createWorkspacePanelApi();
    const p = api.docs!.open("d1");
    const sent = parent.postMessage.mock.calls.at(-1)![0] as { rid: string; item: unknown };
    expect(sent.item).toEqual({ kind: "doc", id: "d1" });
    deliver(wire({ type: "item-reply", rid: sent.rid, ok: false, error: "gone" }));
    await expect(p).resolves.toEqual({ ok: false, error: "gone" });
  });

  it("uses a request id prefix that is unique per panel load", () => {
    createWorkspacePanelApi().canvas!.listTabs();
    const first = (parent.postMessage.mock.calls.at(-1)![0] as { rid: string }).rid;
    createWorkspacePanelApi().canvas!.listTabs();
    const second = (parent.postMessage.mock.calls.at(-1)![0] as { rid: string }).rid;
    expect(first.split("-")[0]).not.toBe(second.split("-")[0]);
    // A reply to the first load's id does not settle the second load's request.
    deliver(wire({ type: "list-reply", rid: first, tabs: [] }));
  });

  it("holds from-tab messages until the first listener and delivers them in order, after the registration returns", async () => {
    const api = createWorkspacePanelApi();
    const mk = (n: number) => ({ id: `e${n}`, sentAt: n, msg: { kind: "started", callId: `c${n}` } });
    deliver(wire({ type: "from-tab", tabId: 1, env: mk(1) }));
    deliver(wire({ type: "from-tab", tabId: 2, env: mk(2) }));
    const cb = vi.fn();
    api.canvas!.onMessage(cb);
    // Registration returns first: the listener's owner may still be mid-construction.
    expect(cb).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(cb.mock.calls).toEqual([[1, mk(1)], [2, mk(2)]]);
    deliver(wire({ type: "from-tab", tabId: 3, env: mk(3) }));
    expect(cb).toHaveBeenCalledTimes(3);
    // A second listener gets no replay.
    const cb2 = vi.fn();
    api.canvas!.onMessage(cb2);
    expect(cb2).not.toHaveBeenCalled();
  });

  it("replays the last tabs push to the first tabs listener only, after the registration returns", async () => {
    const api = createWorkspacePanelApi();
    const t1 = [{ tabId: 1, registrationId: 1, title: "A", active: true }];
    const t2 = [{ tabId: 2, registrationId: 1, title: "B", active: false }];
    deliver(wire({ type: "tabs", tabs: t1 }));
    deliver(wire({ type: "tabs", tabs: t2 }));
    const cb = vi.fn();
    api.canvas!.onTabsChanged(cb);
    expect(cb).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(cb.mock.calls).toEqual([[t2]]);
    const cb2 = vi.fn();
    api.canvas!.onTabsChanged(cb2);
    expect(cb2).not.toHaveBeenCalled();
  });

  it("at the cap drops the oldest selection but never a launch or tab-gone", async () => {
    const api = createWorkspacePanelApi();
    const msg = (kind: string, n: number) => ({ id: `e${n}`, sentAt: n, msg: { kind } });
    deliver(wire({ type: "from-tab", tabId: 1, env: msg("selection", 0) }));
    for (let n = 1; n < 500; n++) deliver(wire({ type: "from-tab", tabId: 1, env: msg("started", n) }));
    deliver(wire({ type: "from-tab", tabId: 1, env: msg("launch", 500) }));
    deliver(wire({ type: "from-tab", tabId: 1, env: msg("tab-gone", 501) }));
    const cb = vi.fn();
    api.canvas!.onMessage(cb);
    await Promise.resolve();
    const kinds = cb.mock.calls.map((c) => c[1].msg.kind);
    // The selection went for the launch; with no selection left the tab-gone is kept past the cap.
    expect(kinds).not.toContain("selection");
    expect(kinds.slice(-2)).toEqual(["launch", "tab-gone"]);
    expect(kinds).toHaveLength(501);
  });
});
