import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wire, type ShellToPanel, type ShellToTab } from "../linkWire";
import {
  ERR_OPEN_CLOSED,
  ERR_OPEN_TIMEOUT,
  OPEN_TIMEOUT_MS,
  ShellRouter,
  type LinkSender,
  type ShellTabInfo,
} from "../shellRouter";

const PANEL: LinkSender = { from: "panel" };
const tab = (tabId: string, kind: "canvas" | "doc" = "canvas"): LinkSender => ({ from: "tab", tabId, kind });
const env = (id: string, kind = "result") => ({ id, sentAt: 1, msg: { kind, callId: "c1", result: "{}" } });

function setup() {
  const toPanel: ShellToPanel[] = [];
  const toTab: Array<{ tabId: string; msg: ShellToTab }> = [];
  let nextOpen = 0;
  const opened: boolean[] = [];
  const activated: string[] = [];
  const woken: string[] = [];
  const router = new ShellRouter({
    postToPanel: (m) => toPanel.push(m),
    postToTab: (tabId, msg) => toTab.push({ tabId, msg }),
    openCanvasTab: () => {
      opened.push(true);
      return `new${++nextOpen}`;
    },
    activateTab: (id) => activated.push(id),
    wakeTab: (id) => woken.push(id),
    openDoc: (id) => (id === "d1" ? { ok: true } : { ok: false, error: "nope" }),
    openWorkflow: () => ({ ok: true }),
    openSettings: (section) => {
      settingsCalls.push(section);
      return { ok: true };
    },
    now: () => 42,
  });
  const settingsCalls: Array<string | undefined> = [];
  const send = (sender: LinkSender, msg: object) => router.handle(sender, wire(msg as { type: string }));
  const tabs = (...ids: Array<[string, string?]>): ShellTabInfo[] => ids.map(([id, title]) => ({ id, kind: "canvas", title: title ?? id }));
  const last = <T extends ShellToPanel["type"]>(type: T) =>
    [...toPanel].reverse().find((m) => m.type === type) as Extract<ShellToPanel, { type: T }> | undefined;
  return { router, toPanel, toTab, opened, woken, activated, settingsCalls, send, tabs, last };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("register, list and MRU", () => {
  it("lists registered canvas tabs, most recently active first, with numeric ids and titles", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a", "Alpha"], ["b", "Beta"]), "a");
    s.send(tab("a"), { type: "register" });
    s.send(tab("b"), { type: "register" });
    s.send(PANEL, { type: "list", rid: "r1" });
    const list = s.last("list-reply")!;
    expect(list.rid).toBe("r1");
    // a was active last, b registered later but never activated.
    expect(list.tabs.map((t) => t.title)).toEqual(["Alpha", "Beta"]);
    expect(list.tabs[0]).toMatchObject({ active: true, registrationId: 1 });
    expect(typeof list.tabs[0].tabId).toBe("number");
    expect(list.tabs[0].tabId).not.toBe(list.tabs[1].tabId);

    s.router.syncTabs(s.tabs(["a", "Alpha"], ["b", "Beta"]), "b");
    expect(s.router.listTabs().map((t) => t.title)).toEqual(["Beta", "Alpha"]);
    expect(s.router.listTabs()[0].active).toBe(true);
  });

  it("a pure reorder of the tab list keeps registrations, numeric ids and the active tab", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a", "Alpha"], ["b", "Beta"]), "a");
    s.send(tab("a"), { type: "register" });
    s.send(tab("b"), { type: "register" });
    const before = s.router.listTabs();
    s.router.syncTabs(s.tabs(["b", "Beta"], ["a", "Alpha"]), "a");
    const after = s.router.listTabs();
    expect(after).toEqual(before);
    expect(s.opened).toEqual([]);
  });

  it("a doc tab in front leaves the order and marks no canvas active", () => {
    const s = setup();
    const list: ShellTabInfo[] = [...s.tabs(["a"], ["b"]), { id: "d", kind: "doc", title: "Doc" }];
    s.router.syncTabs(list, "a");
    s.send(tab("a"), { type: "register" });
    s.send(tab("b"), { type: "register" });
    s.router.syncTabs(list, "d");
    const tabs = s.router.listTabs();
    expect(tabs.map((t) => t.title)).toEqual(["a", "b"]);
    expect(tabs.some((t) => t.active)).toBe(false);
  });

  it("pushes the list when it changes and not when it does not", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(tab("a"), { type: "register" });
    const pushes = () => s.toPanel.filter((m) => m.type === "tabs").length;
    expect(pushes()).toBe(1);
    s.router.syncTabs(s.tabs(["a"]), "a");
    expect(pushes()).toBe(1);
    s.router.syncTabs(s.tabs(["a", "Renamed"]), "a");
    expect(pushes()).toBe(2);
  });

  it("registrationId increments on each register of one tab", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(tab("a"), { type: "register" });
    s.send(tab("a"), { type: "bye" });
    s.send(tab("a"), { type: "register" });
    expect(s.router.listTabs()[0].registrationId).toBe(2);
  });

  it("refuses register from a frame that is not a canvas", () => {
    const s = setup();
    s.router.syncTabs([{ id: "d", kind: "doc", title: "Doc" }], "d");
    s.send(tab("d", "doc"), { type: "register" });
    expect(s.router.listTabs()).toEqual([]);
  });

  it("ignores a message without the wire tag", () => {
    const s = setup();
    s.router.handle(tab("a"), { type: "register" });
    s.router.handle(PANEL, { type: "list", rid: "x" });
    expect(s.toPanel).toEqual([]);
  });
});

describe("open", () => {
  it("answers when the new tab registers", () => {
    const s = setup();
    s.send(PANEL, { type: "open", rid: "o1", activate: true });
    expect(s.opened).toEqual([true]);
    expect(s.last("open-reply")).toBeUndefined();
    s.router.syncTabs(s.tabs(["new1"]), "new1");
    s.send(tab("new1"), { type: "register" });
    const reply = s.last("open-reply")!;
    expect(reply).toMatchObject({ rid: "o1", ok: true, registrationId: 1 });
    expect(s.router.listTabs()[0].tabId).toBe((reply as { tabId: number }).tabId);
  });

  it("answers with an error after 20 s", () => {
    const s = setup();
    s.send(PANEL, { type: "open", rid: "o1" });
    vi.advanceTimersByTime(OPEN_TIMEOUT_MS - 1);
    expect(s.last("open-reply")).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(s.last("open-reply")).toMatchObject({ rid: "o1", ok: false, error: ERR_OPEN_TIMEOUT });
    // A late register finds nothing pending.
    s.send(tab("new1"), { type: "register" });
    expect(s.toPanel.filter((m) => m.type === "open-reply")).toHaveLength(1);
  });

  it("answers with an error when the tab leaves the list before it registered", () => {
    const s = setup();
    s.router.syncTabs([], null);
    s.send(PANEL, { type: "open", rid: "o1" });
    s.router.syncTabs(s.tabs(["new1"]), "new1");
    s.router.syncTabs([], null);
    expect(s.last("open-reply")).toMatchObject({ rid: "o1", ok: false, error: ERR_OPEN_CLOSED });
  });
});

describe("activate and to-tab / from-tab", () => {
  it("activates only a registered tab", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"], ["b"]), "a");
    s.send(tab("a"), { type: "register" });
    const numA = s.router.listTabs()[0].tabId;
    s.send(PANEL, { type: "activate", tabId: numA });
    s.send(PANEL, { type: "activate", tabId: 999 });
    expect(s.activated).toEqual(["a"]);
  });

  it("forwards panel envelopes to the tab and tab envelopes to the panel with the numeric id", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(tab("a"), { type: "register" });
    const numA = s.router.listTabs()[0].tabId;
    s.send(PANEL, { type: "to-tab", tabId: numA, env: env("e1", "call") });
    expect(s.toTab).toEqual([{ tabId: "a", msg: { type: "from-panel", env: env("e1", "call") } }]);
    s.send(tab("a"), { type: "to-panel", env: env("e2") });
    expect(s.last("from-tab")).toMatchObject({ tabId: numA, env: env("e2") });
  });

  it("answers an error for an unknown or unregistered tab", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(PANEL, { type: "to-tab", tabId: 77, env: env("e1", "call") });
    const reply = s.last("from-tab")!;
    expect(reply.tabId).toBe(77);
    expect(reply.env.msg).toMatchObject({ kind: "error", refId: "e1" });
    expect(s.toTab).toEqual([]);
  });

  it("drops router-only kinds and malformed envelopes from frames", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(tab("a"), { type: "register" });
    const numA = s.router.listTabs()[0].tabId;
    const before = s.toPanel.length;
    s.send(tab("a"), { type: "to-panel", env: env("x", "tab-gone") });
    s.send(tab("a"), { type: "to-panel", env: { id: 1 } });
    s.send(PANEL, { type: "to-tab", tabId: numA, env: env("y", "panel-gone") });
    expect(s.toPanel.length).toBe(before);
    expect(s.toTab).toEqual([]);
  });

  it("drops to-panel from an unregistered tab", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(tab("a"), { type: "to-panel", env: env("e") });
    expect(s.toPanel.filter((m) => m.type === "from-tab")).toEqual([]);
  });
});

describe("tab-gone", () => {
  const gone = (s: ReturnType<typeof setup>) =>
    s.toPanel.filter((m): m is Extract<ShellToPanel, { type: "from-tab" }> => m.type === "from-tab" && m.env.msg.kind === "tab-gone");

  it("is sent when a registered tab leaves the shell's list, and the list is pushed", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"], ["b"]), "a");
    s.send(tab("a"), { type: "register" });
    s.router.syncTabs(s.tabs(["b"]), "b");
    expect(gone(s)).toHaveLength(1);
    expect(gone(s)[0].env.msg).toEqual({ kind: "tab-gone", registrationId: 1 });
    expect(s.last("tabs")!.tabs).toEqual([]);
  });

  it.each(["bye", "unregister"])("is sent on %s", (type) => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(tab("a"), { type: "register" });
    s.send(tab("a"), { type });
    expect(gone(s)).toHaveLength(1);
    s.send(tab("a"), { type }); // idempotent
    expect(gone(s)).toHaveLength(1);
  });

  it("is sent for the old registration first when a tab registers again", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(tab("a"), { type: "register" });
    s.send(tab("a"), { type: "register" });
    expect(gone(s)).toHaveLength(1);
    expect(gone(s)[0].env.msg).toEqual({ kind: "tab-gone", registrationId: 1 });
    expect(s.router.listTabs()[0].registrationId).toBe(2);
  });
});

describe("panel hello", () => {
  it("pushes the list on the first hello and sends panel-gone to every registered tab on the second", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"], ["b"], ["c"]), "a");
    s.send(tab("a"), { type: "register" });
    s.send(tab("b"), { type: "register" });
    s.send(PANEL, { type: "hello" });
    expect(s.toTab).toEqual([]);
    expect(s.toPanel.at(-1)).toMatchObject({ type: "tabs" });
    s.send(PANEL, { type: "hello" });
    expect(s.toTab.map((t) => t.tabId).sort()).toEqual(["a", "b"]);
    expect(s.toTab[0].msg.env.msg).toEqual({ kind: "panel-gone" });
    // The reloaded panel knows no list: the push is not deduped away.
    expect(s.toPanel.at(-1)).toMatchObject({ type: "tabs" });
  });
});

describe("open-item", () => {
  it("routes doc, workflow and settings opens and replies", () => {
    const s = setup();
    s.send(PANEL, { type: "open-item", rid: "i1", item: { kind: "doc", id: "d1" } });
    expect(s.last("item-reply")).toEqual({ type: "item-reply", rid: "i1", ok: true });
    s.send(PANEL, { type: "open-item", rid: "i2", item: { kind: "doc", id: "zz" } });
    expect(s.last("item-reply")).toEqual({ type: "item-reply", rid: "i2", ok: false, error: "nope" });
    s.send(PANEL, { type: "open-item", rid: "i3", item: { kind: "settings", section: "memory" } });
    expect(s.settingsCalls).toEqual(["memory"]);
    s.send(PANEL, { type: "open-item", rid: "i4", item: { kind: "bogus" } });
    expect(s.last("item-reply")).toMatchObject({ rid: "i4", ok: false });
  });
});

describe("open: wake or create", () => {
  it("activate !== true wakes the most recently active unregistered canvas tab", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"], ["b"], ["c"]), "b");
    s.router.syncTabs(s.tabs(["a"], ["b"], ["c"]), "a");
    s.send(tab("c"), { type: "register" }); // c is registered: never a candidate
    s.send(PANEL, { type: "open", rid: "o1" });
    expect(s.opened).toEqual([]);
    expect(s.woken).toEqual(["a"]);
    s.send(tab("a"), { type: "register" });
    expect(s.last("open-reply")).toMatchObject({ rid: "o1", ok: true, registrationId: 1 });
  });

  it("wakes a tab that is mounted but still loading (unregistered) the same way", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(PANEL, { type: "open", rid: "o1", activate: false });
    expect(s.woken).toEqual(["a"]);
    expect(s.opened).toEqual([]);
  });

  it("creates a blank canvas when no unregistered canvas tab exists", () => {
    const s = setup();
    s.router.syncTabs([...s.tabs(["a"]), { id: "d", kind: "doc", title: "Doc" }], "a");
    s.send(tab("a"), { type: "register" });
    s.send(PANEL, { type: "open", rid: "o1" });
    expect(s.opened).toEqual([true]);
    expect(s.woken).toEqual([]);
  });

  it("activate === true always creates a new tab, even with an unregistered one in the strip", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(PANEL, { type: "open", rid: "o1", activate: true });
    expect(s.opened).toEqual([true]);
    expect(s.woken).toEqual([]);
  });

  it("two implicit opens in a row share one tab", () => {
    const s = setup();
    s.router.syncTabs([], null);
    s.send(PANEL, { type: "open", rid: "o1" });
    s.router.syncTabs(s.tabs(["new1"]), "new1");
    s.send(PANEL, { type: "open", rid: "o2" });
    expect(s.opened).toHaveLength(1);
    s.send(tab("new1"), { type: "register" });
    expect(s.toPanel.filter((m) => m.type === "open-reply").map((m) => (m as { rid: string }).rid)).toEqual(["o1", "o2"]);
  });
});

describe("panel reload", () => {
  it("a second hello drops pending opens: no reply, no late timeout", () => {
    const s = setup();
    s.router.syncTabs([], null);
    s.send(PANEL, { type: "hello" });
    s.send(PANEL, { type: "open", rid: "o1" });
    s.send(PANEL, { type: "hello" });
    vi.advanceTimersByTime(OPEN_TIMEOUT_MS + 1);
    s.router.syncTabs(s.tabs(["new1"]), "new1");
    s.send(tab("new1"), { type: "register" });
    expect(s.toPanel.filter((m) => m.type === "open-reply")).toEqual([]);
  });
});

describe("wake timeout", () => {
  const replies = (s: ReturnType<typeof setup>) => s.toPanel.filter((m) => m.type === "open-reply");

  it("marks the silent tab, falls back to a new tab in the same request, and answers when that one registers", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(PANEL, { type: "open", rid: "o1" });
    expect(s.woken).toEqual(["a"]);
    vi.advanceTimersByTime(OPEN_TIMEOUT_MS);
    expect(replies(s)).toEqual([]);
    expect(s.opened).toEqual([true]);
    s.router.syncTabs(s.tabs(["a"], ["new1"]), "new1");
    s.send(tab("new1"), { type: "register" });
    expect(s.last("open-reply")).toMatchObject({ rid: "o1", ok: true });
  });

  it("a failed tab is not woken again, and the fallback has its own 20 s limit", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(PANEL, { type: "open", rid: "o1" });
    vi.advanceTimersByTime(OPEN_TIMEOUT_MS);
    s.router.syncTabs(s.tabs(["a"], ["new1"]), "new1");
    // Another implicit open joins the pending fallback tab, not the failed one.
    s.send(PANEL, { type: "open", rid: "o2" });
    expect(s.woken).toEqual(["a", "new1"]);
    vi.advanceTimersByTime(OPEN_TIMEOUT_MS);
    expect(s.last("open-reply")).toMatchObject({ ok: false, error: ERR_OPEN_TIMEOUT });
  });

  it("a later register of the failed tab clears the mark", () => {
    const s = setup();
    s.router.syncTabs(s.tabs(["a"]), "a");
    s.send(PANEL, { type: "open", rid: "o1" });
    vi.advanceTimersByTime(OPEN_TIMEOUT_MS);
    s.send(tab("a"), { type: "register" });
    s.send(tab("a"), { type: "bye" });
    s.send(PANEL, { type: "open", rid: "o2" });
    expect(s.woken).toEqual(["a", "a"]);
  });
});
