import { describe, expect, it } from "vitest";

import {
  EMPTY_TABS,
  itemIdFromLocation,
  parseTabsState,
  saveTabsState,
  TABS_SESSION_KEY,
  tabUrl,
  tabsReducer,
  type TabsState,
} from "../tabsModel";

const open = (state: TabsState, tabId: string, kind: "canvas" | "doc" | "workflow" | "settings", itemId: string | null, title = "T") =>
  tabsReducer(state, { type: "open", tabId, kind, itemId, title });

describe("tabsReducer", () => {
  it("opens a tab and activates it", () => {
    const s = open(EMPTY_TABS, "t1", "canvas", "cv_1");
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe("t1");
  });

  it("focuses the existing tab for the same kind and id", () => {
    let s = open(EMPTY_TABS, "t1", "doc", "d1");
    s = open(s, "t2", "doc", "d2");
    s = open(s, "t3", "doc", "d1");
    expect(s.tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(s.activeTabId).toBe("t1");
  });

  it("treats the same id under another kind as another tab", () => {
    let s = open(EMPTY_TABS, "t1", "doc", "x");
    s = open(s, "t2", "workflow", "x");
    expect(s.tabs).toHaveLength(2);
  });

  it("keeps settings a singleton", () => {
    let s = open(EMPTY_TABS, "t1", "settings", null);
    s = open(s, "t2", "canvas", "cv_1");
    s = open(s, "t3", "settings", null);
    expect(s.tabs.filter((t) => t.kind === "settings")).toHaveLength(1);
    expect(s.activeTabId).toBe("t1");
  });

  it("home shows the start page and keeps the tabs", () => {
    const s = tabsReducer(open(EMPTY_TABS, "t1", "canvas", "cv_1"), { type: "home" });
    expect(s.activeTabId).toBeNull();
    expect(s.tabs).toHaveLength(1);
  });

  it("closing the active tab activates the right neighbour, else the left, else the start page", () => {
    let s = open(open(open(EMPTY_TABS, "a", "doc", "1"), "b", "doc", "2"), "c", "doc", "3");
    s = tabsReducer(s, { type: "focus", tabId: "b" });
    s = tabsReducer(s, { type: "close", tabId: "b" });
    expect(s.activeTabId).toBe("c");
    s = tabsReducer(s, { type: "close", tabId: "c" });
    expect(s.activeTabId).toBe("a");
    s = tabsReducer(s, { type: "close", tabId: "a" });
    expect(s.activeTabId).toBeNull();
    expect(s.tabs).toEqual([]);
  });

  it("closing an inactive tab keeps the active one", () => {
    let s = open(open(EMPTY_TABS, "a", "doc", "1"), "b", "doc", "2");
    s = tabsReducer(s, { type: "close", tabId: "a" });
    expect(s.activeTabId).toBe("b");
  });

  it("renames by kind and id, and closeItem removes without needing a tab id", () => {
    let s = open(EMPTY_TABS, "a", "doc", "1", "Old");
    s = tabsReducer(s, { type: "rename", kind: "doc", itemId: "1", title: "New" });
    expect(s.tabs[0].title).toBe("New");
    s = tabsReducer(s, { type: "closeItem", kind: "doc", itemId: "1" });
    expect(s.tabs).toEqual([]);
  });
});

describe("parseTabsState", () => {
  it("returns the start page for missing or broken JSON", () => {
    expect(parseTabsState(null)).toEqual(EMPTY_TABS);
    expect(parseTabsState("{nope")).toEqual(EMPTY_TABS);
    expect(parseTabsState("[]")).toEqual(EMPTY_TABS);
    expect(parseTabsState('{"tabs":5}')).toEqual(EMPTY_TABS);
  });

  it("round-trips a valid state", () => {
    const s = open(open(EMPTY_TABS, "t1", "canvas", "cv_1", "A"), "t2", "settings", null, "Settings");
    expect(parseTabsState(JSON.stringify(s))).toEqual({ tabs: s.tabs, activeTabId: s.activeTabId });
  });

  it("drops invalid entries, duplicates and unknown kinds", () => {
    const raw = JSON.stringify({
      tabs: [
        { id: "t1", kind: "canvas", itemId: "cv_1", title: "ok" },
        { id: "t1", kind: "doc", itemId: "d1", title: "dup tab id" },
        { id: "t2", kind: "browser", itemId: "x", title: "unknown kind" },
        { id: "t3", kind: "doc", itemId: "../evil", title: "bad item id" },
        { id: "t4", kind: "doc", title: "no item id" },
        { id: "t5", kind: "canvas", itemId: "cv_1", title: "dup item" },
        { id: "t6", kind: "settings", itemId: null, title: 7 },
        { id: "t7", kind: "settings", itemId: null, title: "second settings" },
        null,
        "str",
      ],
      activeTabId: "t3",
    });
    const s = parseTabsState(raw);
    expect(s.tabs.map((t) => t.id)).toEqual(["t1", "t6"]);
    expect(s.tabs[1].title).toBe("");
    // The active id pointed at a dropped tab: start page.
    expect(s.activeTabId).toBeNull();
  });

  it("keeps a valid active tab", () => {
    const raw = JSON.stringify({ tabs: [{ id: "t1", kind: "doc", itemId: "d1", title: "x" }], activeTabId: "t1" });
    expect(parseTabsState(raw).activeTabId).toBe("t1");
  });
});

describe("tabUrl", () => {
  it("forms the frame URL of each kind", () => {
    expect(tabUrl({ kind: "canvas", itemId: "cv_1" })).toBe("/app?canvas=cv_1&chat=off");
    expect(tabUrl({ kind: "doc", itemId: "d1" })).toBe("/doc?id=d1&chat=off");
    expect(tabUrl({ kind: "workflow", itemId: "w1" })).toBe("/workflow?id=w1&chat=off");
    expect(tabUrl({ kind: "settings", itemId: null })).toBe("/settings?chat=off");
  });

  it("adds a known settings section and ignores an unknown one", () => {
    expect(tabUrl({ kind: "settings", itemId: null, section: "memory" })).toBe("/settings?chat=off&section=memory");
    expect(tabUrl({ kind: "settings", itemId: null, section: "nope" })).toBe("/settings?chat=off");
  });

  it("opening the settings tab again with a section stores it and activates the tab", () => {
    const s0 = open(open(EMPTY_TABS, "t1", "settings", null), "t2", "doc", "d1");
    const s1 = tabsReducer(s0, { type: "open", tabId: "tx", kind: "settings", itemId: null, title: "Settings", section: "agent" });
    expect(s1.activeTabId).toBe("t1");
    expect(s1.tabs.find((t) => t.id === "t1")?.section).toBe("agent");
  });
});

describe("rebind", () => {
  const base = () => open(open(open(EMPTY_TABS, "t1", "doc", "d1"), "t2", "doc", "d2"), "t3", "canvas", "cv_1");

  it("changes the itemId and keeps the tab and its place", () => {
    const s = tabsReducer(base(), { type: "rebind", tabId: "t1", itemId: "d9" });
    expect(s.tabs.map((t) => [t.id, t.itemId])).toEqual([["t1", "d9"], ["t2", "d2"], ["t3", "cv_1"]]);
  });

  it("closes another tab bound to the same kind and item, and keeps the same item of another kind", () => {
    const s = tabsReducer(base(), { type: "rebind", tabId: "t1", itemId: "d2" });
    expect(s.tabs.map((t) => t.id)).toEqual(["t1", "t3"]);
    const c = tabsReducer(base(), { type: "rebind", tabId: "t3", itemId: "d2" });
    expect(c.tabs).toHaveLength(3);
  });

  it("moves the active tab to the rebound one when the active tab was the duplicate", () => {
    const s = tabsReducer({ ...base(), activeTabId: "t2" }, { type: "rebind", tabId: "t1", itemId: "d2" });
    expect(s.activeTabId).toBe("t1");
  });

  it("ignores unknown tabs, settings, an unchanged item and invalid ids", () => {
    const b = base();
    expect(tabsReducer(b, { type: "rebind", tabId: "nope", itemId: "x" })).toBe(b);
    expect(tabsReducer(b, { type: "rebind", tabId: "t1", itemId: "d1" })).toBe(b);
    expect(tabsReducer(b, { type: "rebind", tabId: "t1", itemId: "bad id" })).toBe(b);
    const st = open(EMPTY_TABS, "s", "settings", null);
    expect(tabsReducer(st, { type: "rebind", tabId: "s", itemId: "x" })).toBe(st);
  });
});

describe("itemIdFromLocation", () => {
  it("reads the id param for the tab kind's path only", () => {
    expect(itemIdFromLocation("canvas", "/app", "?canvas=cv_2")).toBe("cv_2");
    expect(itemIdFromLocation("doc", "/doc/", "?id=d3&chat=off")).toBe("d3");
    expect(itemIdFromLocation("workflow", "/workflow", "?id=w3")).toBe("w3");
    expect(itemIdFromLocation("doc", "/app", "?id=d3")).toBeNull();
    expect(itemIdFromLocation("doc", "/doc", "")).toBeNull();
    expect(itemIdFromLocation("doc", "/doc", "?id=a%20b")).toBeNull();
    expect(itemIdFromLocation("settings", "/settings", "?id=x")).toBeNull();
  });
});

describe("agent intent (focusFrame, mountIds)", () => {
  const agentOpen = (state: TabsState, tabId: string, kind: "canvas" | "doc", itemId: string) =>
    tabsReducer(state, { type: "open", tabId, kind, itemId, title: "T", agent: true });

  it("an agent open or focus mounts the tab and leaves the frame unfocused; a user one focuses", () => {
    let s = agentOpen(EMPTY_TABS, "t1", "canvas", "cv_1");
    expect(s.focusFrame).toBe(false);
    expect(s.mountIds).toEqual(["t1"]);
    s = open(s, "t2", "doc", "d1");
    expect(s.focusFrame).toBe(true);
    s = tabsReducer(s, { type: "focus", tabId: "t1", agent: true });
    expect(s).toMatchObject({ activeTabId: "t1", focusFrame: false });
    expect(tabsReducer(s, { type: "focus", tabId: "t2" }).focusFrame).toBe(true);
  });

  it("two agent opens of the same item before a commit resolve to one tab id in mountIds", () => {
    let s = agentOpen(EMPTY_TABS, "t1", "doc", "d1");
    s = agentOpen(s, "t2", "doc", "d1");
    expect(s.tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(s.mountIds).toEqual(["t1"]);
  });

  it("two agent opens of different canvases keep both mounted, the last one in front", () => {
    let s = agentOpen(EMPTY_TABS, "t1", "canvas", "cv_1");
    s = agentOpen(s, "t2", "canvas", "cv_2");
    expect(s.mountIds).toEqual(["t1", "t2"]);
    expect(s).toMatchObject({ activeTabId: "t2", focusFrame: false });
  });

  it("close and closeItem prune mountIds", () => {
    let s = agentOpen(agentOpen(EMPTY_TABS, "t1", "canvas", "cv_1"), "t2", "doc", "d1");
    s = tabsReducer(s, { type: "close", tabId: "t1" });
    expect(s.mountIds).toEqual(["t2"]);
    s = tabsReducer(s, { type: "closeItem", kind: "doc", itemId: "d1" });
    expect(s.mountIds).toEqual([]);
  });

  it("saveTabsState writes only tabs and activeTabId", () => {
    const s = agentOpen(EMPTY_TABS, "t1", "canvas", "cv_1");
    saveTabsState(s);
    const saved = JSON.parse(window.sessionStorage.getItem(TABS_SESSION_KEY)!);
    expect(Object.keys(saved).sort()).toEqual(["activeTabId", "tabs"]);
    expect(parseTabsState(JSON.stringify({ ...saved, focusFrame: false, mountIds: ["t1"] }))).toEqual({ tabs: saved.tabs, activeTabId: "t1" });
  });
});

describe("move (drag to reorder)", () => {
  const base = () => {
    let s = open(EMPTY_TABS, "a", "canvas", "cv_1");
    s = open(s, "b", "doc", "d1");
    s = open(s, "c", "doc", "d2");
    return tabsReducer(s, { type: "focus", tabId: "b", agent: true });
  };
  const ids = (s: TabsState) => s.tabs.map((t) => t.id);

  it("moves a tab before another and to the end, leaving the rest of the state alone", () => {
    const s = base();
    const m = tabsReducer(s, { type: "move", tabId: "c", beforeId: "a" });
    expect(ids(m)).toEqual(["c", "a", "b"]);
    expect(m.activeTabId).toBe("b");
    expect(m.focusFrame).toBe(false);
    expect(m.mountIds).toEqual(s.mountIds);
    expect(ids(tabsReducer(s, { type: "move", tabId: "a", beforeId: null }))).toEqual(["b", "c", "a"]);
    expect(ids(tabsReducer(s, { type: "move", tabId: "a", beforeId: "c" }))).toEqual(["b", "a", "c"]);
  });

  it("returns the same state for a no-op or an unknown id", () => {
    const s = base();
    expect(tabsReducer(s, { type: "move", tabId: "a", beforeId: "a" })).toBe(s);
    expect(tabsReducer(s, { type: "move", tabId: "a", beforeId: "b" })).toBe(s);
    expect(tabsReducer(s, { type: "move", tabId: "c", beforeId: null })).toBe(s);
    expect(tabsReducer(s, { type: "move", tabId: "zz", beforeId: null })).toBe(s);
    expect(tabsReducer(s, { type: "move", tabId: "a", beforeId: "zz" })).toBe(s);
  });
});
