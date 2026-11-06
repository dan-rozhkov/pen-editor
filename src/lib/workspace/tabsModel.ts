// Pure, React-free model of the in-page tab shell at `/workspace`: the tab list, the active
// tab (null = the start page) and the JSON the shell keeps in localStorage.

import { appHref } from "@/lib/auth/paths";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/openSettings";

export type TabKind = "canvas" | "doc" | "workflow" | "settings";

export interface WorkspaceTab {
  id: string;
  kind: TabKind;
  /** The canvas, document or workflow id. null for the settings singleton. */
  itemId: string | null;
  title: string;
  /** Settings only: the section its frame opens on. Read once, when the frame mounts; never persisted. */
  section?: SettingsSection;
}

export interface TabsState {
  tabs: WorkspaceTab[];
  /** null shows the start page. The start page is not a tab. */
  activeTabId: string | null;
  /**
   * Runtime only (never saved or restored). false while the active tab was changed on the agent's
   * behalf: its frame must not take keyboard focus from the chat. Absent counts as true.
   */
  focusFrame?: boolean;
  /** Runtime only. Tabs whose frame must mount although they are not active (the agent opened or woke them). */
  mountIds?: readonly string[];
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

/** true for an id a tab may carry (the same check `parseTabsState` applies). */
export function isValidItemId(id: string): boolean {
  return ITEM_ID_RE.test(id);
}
const TAB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TITLE = 200;

export type TabsAction =
  /** `agent: true`: the agent drives it. The tab mounts and comes forward without taking keyboard focus. */
  | { type: "open"; tabId: string; kind: TabKind; itemId: string | null; title: string; section?: SettingsSection; agent?: true }
  | { type: "focus"; tabId: string; agent?: true }
  | { type: "home" }
  | { type: "close"; tabId: string }
  | { type: "closeItem"; kind: TabKind; itemId: string }
  | { type: "rename"; kind: TabKind; itemId: string; title: string }
  /** The frame of a tab moved to another item on its own (history call, no load event). */
  | { type: "rebind"; tabId: string; itemId: string }
  /** Drag to reorder: puts the tab before `beforeId` (null = at the end). The active tab does not change. */
  | { type: "move"; tabId: string; beforeId: string | null };

export function makeTabId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return "t_" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function findTab(state: TabsState, kind: TabKind, itemId: string | null): WorkspaceTab | undefined {
  return state.tabs.find((t) => t.kind === kind && (kind === "settings" || t.itemId === itemId));
}

/** Records who changed the active tab (the user focuses the frame, the agent does not) and mounts the agent's tab. */
function withIntent(state: TabsState, tabId: string, { agent }: { agent?: true }): TabsState {
  const mountIds = agent && !state.mountIds?.includes(tabId) ? [...(state.mountIds ?? []), tabId] : state.mountIds;
  return { ...state, focusFrame: !agent, ...(mountIds ? { mountIds } : {}) };
}

/** Drops mount requests of tabs that are gone. */
function pruneMounts(state: TabsState): TabsState {
  if (!state.mountIds) return state;
  const mountIds = state.mountIds.filter((id) => state.tabs.some((t) => t.id === id));
  return mountIds.length === state.mountIds.length ? state : { ...state, mountIds };
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "open": {
      const itemId = action.kind === "settings" ? null : action.itemId;
      const existing = findTab(state, action.kind, itemId);
      const section = action.kind === "settings" ? action.section : undefined;
      const intent = { agent: action.agent };
      if (existing) {
        const tabs = section && existing.section !== section ? state.tabs.map((t) => (t === existing ? { ...t, section } : t)) : state.tabs;
        return withIntent({ ...state, tabs, activeTabId: existing.id }, existing.id, intent);
      }
      const tab: WorkspaceTab = { id: action.tabId, kind: action.kind, itemId, title: action.title, ...(section ? { section } : {}) };
      return withIntent({ ...state, tabs: [...state.tabs, tab], activeTabId: tab.id }, tab.id, intent);
    }
    case "focus":
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      return withIntent({ ...state, activeTabId: action.tabId }, action.tabId, { agent: action.agent });
    case "home":
      return state.activeTabId === null ? state : { ...state, activeTabId: null };
    case "close": {
      const index = state.tabs.findIndex((t) => t.id === action.tabId);
      if (index === -1) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.tabId);
      if (state.activeTabId !== action.tabId) return pruneMounts({ ...state, tabs });
      // Right neighbour, else left neighbour, else the start page.
      const next = tabs[index] ?? tabs[index - 1] ?? null;
      return pruneMounts({ ...state, tabs, activeTabId: next ? next.id : null, focusFrame: true });
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
      return pruneMounts({ ...state, tabs, activeTabId });
    }
    case "move": {
      const tab = state.tabs.find((t) => t.id === action.tabId);
      if (!tab || action.beforeId === action.tabId) return state;
      const rest = state.tabs.filter((t) => t !== tab);
      const at = action.beforeId === null ? rest.length : rest.findIndex((t) => t.id === action.beforeId);
      if (at === -1 || at === state.tabs.indexOf(tab)) return state;
      rest.splice(at, 0, tab);
      return { ...state, tabs: rest };
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
  // Only the tabs and the active one: the runtime fields (focusFrame, mountIds) are not persisted.
  const json = JSON.stringify({ tabs: state.tabs, activeTabId: state.activeTabId });
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
export function tabUrl(tab: Pick<WorkspaceTab, "kind" | "itemId"> & { section?: string }): string {
  const id = encodeURIComponent(tab.itemId ?? "");
  switch (tab.kind) {
    case "canvas":
      return appHref(`/app?canvas=${id}&chat=off`);
    case "doc":
      return appHref(`/doc?id=${id}&chat=off`);
    case "workflow":
      return appHref(`/workflow?id=${id}&chat=off`);
    case "settings": {
      const section = SETTINGS_SECTIONS.find((s) => s === tab.section);
      return appHref(`/settings?chat=off${section ? `&section=${section}` : ""}`);
    }
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
