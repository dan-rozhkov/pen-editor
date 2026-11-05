// Pure, React-free model of the in-page tab shell at `/workspace`: the tab list, the active
// tab (null = the start page) and the JSON the shell keeps in localStorage.

import { appHref } from "@/lib/auth/paths";

export type TabKind = "canvas" | "doc" | "workflow" | "settings";

export interface WorkspaceTab {
  id: string;
  kind: TabKind;
  /** The canvas, document or workflow id. null for the settings singleton. */
  itemId: string | null;
  title: string;
}

export interface TabsState {
  tabs: WorkspaceTab[];
  /** null shows the start page. The start page is not a tab. */
  activeTabId: string | null;
}

/** localStorage: the last state any window wrote. Only the seed for a window that has no own state. */
export const TABS_STORAGE_KEY = "pen.workspace.tabs.v1";
/**
 * sessionStorage: this window's own state; survives a reload and is not shared with other
 * windows. Dedicated key, because frames of the shell share sessionStorage with this page.
 */
export const TABS_SESSION_KEY = "pen.workspace.tabs.window.v1";
export const EMPTY_TABS: TabsState = { tabs: [], activeTabId: null };

const KINDS: readonly TabKind[] = ["canvas", "doc", "workflow", "settings"];
const ITEM_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TAB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TITLE = 200;

export type TabsAction =
  | { type: "open"; tabId: string; kind: TabKind; itemId: string | null; title: string }
  | { type: "focus"; tabId: string }
  | { type: "home" }
  | { type: "close"; tabId: string }
  | { type: "closeItem"; kind: TabKind; itemId: string }
  | { type: "rename"; kind: TabKind; itemId: string; title: string }
  /** The frame of a tab moved to another item on its own (history call, no load event). */
  | { type: "rebind"; tabId: string; itemId: string };

export function makeTabId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return "t_" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function findTab(state: TabsState, kind: TabKind, itemId: string | null): WorkspaceTab | undefined {
  return state.tabs.find((t) => t.kind === kind && (kind === "settings" || t.itemId === itemId));
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "open": {
      const itemId = action.kind === "settings" ? null : action.itemId;
      const existing = findTab(state, action.kind, itemId);
      if (existing) return state.activeTabId === existing.id ? state : { ...state, activeTabId: existing.id };
      const tab: WorkspaceTab = { id: action.tabId, kind: action.kind, itemId, title: action.title };
      return { tabs: [...state.tabs, tab], activeTabId: tab.id };
    }
    case "focus":
      if (!state.tabs.some((t) => t.id === action.tabId) || state.activeTabId === action.tabId) return state;
      return { ...state, activeTabId: action.tabId };
    case "home":
      return state.activeTabId === null ? state : { ...state, activeTabId: null };
    case "close": {
      const index = state.tabs.findIndex((t) => t.id === action.tabId);
      if (index === -1) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.tabId);
      if (state.activeTabId !== action.tabId) return { ...state, tabs };
      // Right neighbour, else left neighbour, else the start page.
      const next = tabs[index] ?? tabs[index - 1] ?? null;
      return { tabs, activeTabId: next ? next.id : null };
    }
    case "closeItem": {
      const tab = findTab(state, action.kind, action.itemId);
      return tab ? tabsReducer(state, { type: "close", tabId: tab.id }) : state;
    }
    case "rebind": {
      const tab = state.tabs.find((t) => t.id === action.tabId);
      if (!tab || tab.kind === "settings" || tab.itemId === action.itemId || !ITEM_ID_RE.test(action.itemId)) return state;
      // Any OTHER tab already showing that item goes away: one tab per item.
      const tabs = state.tabs
        .filter((t) => t.id === tab.id || !(t.kind === tab.kind && t.itemId === action.itemId))
        .map((t) => (t.id === tab.id ? { ...t, itemId: action.itemId } : t));
      const activeTabId = tabs.some((t) => t.id === state.activeTabId) ? state.activeTabId : tab.id;
      return { tabs, activeTabId };
    }
    case "rename": {
      const title = action.title;
      let changed = false;
      const tabs = state.tabs.map((t) => {
        if (t.kind !== action.kind || t.itemId !== action.itemId || t.title === title) return t;
        changed = true;
        return { ...t, title };
      });
      return changed ? { ...state, tabs } : state;
    }
  }
}

/** Validates what localStorage returned. Invalid entries are dropped; anything unusable gives the start page. */
export function parseTabsState(raw: string | null): TabsState {
  if (!raw) return EMPTY_TABS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_TABS;
  }
  if (typeof value !== "object" || value === null) return EMPTY_TABS;
  const { tabs: rawTabs, activeTabId } = value as { tabs?: unknown; activeTabId?: unknown };
  if (!Array.isArray(rawTabs)) return EMPTY_TABS;
  const tabs: WorkspaceTab[] = [];
  const ids = new Set<string>();
  for (const entry of rawTabs) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, kind, itemId, title } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !TAB_ID_RE.test(id) || ids.has(id)) continue;
    if (typeof kind !== "string" || !KINDS.includes(kind as TabKind)) continue;
    const k = kind as TabKind;
    let item: string | null = null;
    if (k !== "settings") {
      if (typeof itemId !== "string" || !ITEM_ID_RE.test(itemId)) continue;
      item = itemId;
    }
    const tab: WorkspaceTab = {
      id,
      kind: k,
      itemId: item,
      title: typeof title === "string" ? title.slice(0, MAX_TITLE) : "",
    };
    if (findTab({ tabs, activeTabId: null }, k, item)) continue;
    ids.add(id);
    tabs.push(tab);
  }
  return { tabs, activeTabId: typeof activeTabId === "string" && ids.has(activeTabId) ? activeTabId : null };
}

function safeGet(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

/** This window's own state (sessionStorage); else the shared last-written one as a seed. */
export function loadTabsState(): TabsState {
  const own = safeGet(() => window.sessionStorage, TABS_SESSION_KEY);
  return parseTabsState(own ?? safeGet(() => window.localStorage, TABS_STORAGE_KEY));
}

export function saveTabsState(state: TabsState): void {
  const json = JSON.stringify(state);
  try {
    window.sessionStorage.setItem(TABS_SESSION_KEY, json);
  } catch {
    /* storage blocked: tabs just do not survive a reload */
  }
  try {
    window.localStorage.setItem(TABS_STORAGE_KEY, json);
  } catch {
    /* storage blocked or full: a new window starts empty */
  }
}

/** The iframe URL of a tab (same origin, under the router base). */
export function tabUrl(tab: Pick<WorkspaceTab, "kind" | "itemId">): string {
  const id = encodeURIComponent(tab.itemId ?? "");
  switch (tab.kind) {
    case "canvas":
      return appHref(`/app?canvas=${id}`);
    case "doc":
      return appHref(`/doc?id=${id}&chat=off`);
    case "workflow":
      return appHref(`/workflow?id=${id}`);
    case "settings":
      return appHref("/settings");
  }
}

export const UNTITLED_CANVAS_TITLE = "Untitled canvas";

// Same shape as `generateCanvasId` in canvasIdentity.ts (`cv_` + 16 lowercase alphanumerics). Kept
// here because canvasIdentity imports the scene stores, which this shell must never load.
const CANVAS_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newCanvasId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "cv_";
  for (const b of bytes) out += CANVAS_ALPHABET[b % CANVAS_ALPHABET.length];
  return out;
}

/** The label of a tab; an unnamed one reads "Untitled" ("Settings" for the settings tab). */
export function tabTitle(tab: Pick<WorkspaceTab, "kind" | "title">): string {
  if (tab.title) return tab.title;
  return tab.kind === "settings" ? "Settings" : "Untitled";
}

const BINDING: Record<Exclude<TabKind, "settings">, { path: string; param: string }> = {
  canvas: { path: "/app", param: "canvas" },
  doc: { path: "/doc", param: "id" },
  workflow: { path: "/workflow", param: "id" },
};

/**
 * The item a frame shows now, read from its location (`pathname` without the router base).
 * null when the path does not belong to the tab kind or the id param is missing or invalid.
 */
export function itemIdFromLocation(kind: TabKind, pathname: string, search: string): string | null {
  if (kind === "settings") return null;
  const { path, param } = BINDING[kind];
  if ((pathname.replace(/\/+$/, "") || "/") !== path) return null;
  const id = new URLSearchParams(search).get(param);
  return id !== null && ITEM_ID_RE.test(id) ? id : null;
}
