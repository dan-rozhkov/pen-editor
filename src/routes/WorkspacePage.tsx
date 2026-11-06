import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import type { CSSProperties } from "react";
import { Navigate } from "react-router";
import { toast } from "sonner";

import { ToasterBase } from "@/components/ui/ToasterBase";

import { StartPage } from "@/components/workspace/StartPage";
import { TabFrames } from "@/components/workspace/TabFrames";
import { TabStrip, type NewTabChoice } from "@/components/workspace/TabStrip";
import { appHref, stripBase } from "@/lib/auth/paths";
import { subscribeWebCanvases, webCanvasStore } from "@/lib/canvases/webCanvasStore";
import { DEFAULT_DOC_TITLE, createDoc, listDocs, subscribeDocs } from "@/lib/docs/docStore";
import { DEFAULT_WORKFLOW_TITLE, createWorkflow, listWorkflows, newStepId, subscribeWorkflows } from "@/lib/workflows/workflowStore";
import { SETTINGS_SECTIONS, SETTINGS_SECTION_EVENT, type SettingsSection } from "@/lib/openSettings";
import { isWireMessage, wire } from "@/lib/workspace/linkWire";
import { ShellRouter, type ItemResult } from "@/lib/workspace/shellRouter";
import type { RecentItem, RecentKind } from "@/lib/workspace/recent";
import {
  UNTITLED_CANVAS_TITLE,
  itemIdFromLocation,
  loadTabsState,
  makeTabId,
  isValidItemId,
  newCanvasId,
  saveTabsState,
  tabTitle,
  tabsReducer,
  type WorkspaceTab,
  type TabKind,
} from "@/lib/workspace/tabsModel";

// Above READY_CAP_MS (5000) of the frame's own load wait, so a slow load is not mistaken for a hang.
const FLUSH_CAP_MS = 10_000;
const REBIND_POLL_MS = 1000;
export const UNSAVED_CLOSE_MESSAGE =
  "This canvas could not be saved. Export it, or close the tab again to discard it.";
const TIMED_OUT = Symbol("flush timed out");
// Same width as the desktop shell's agent panel (pen-editor-desktop `AGENT_PANEL_DEFAULT_WIDTH`).
const AGENT_PANEL_WIDTH = 380;

/**
 * "/workspace": the browser counterpart of the desktop shell. A left island with the agent chat
 * (a same-origin `/agent` iframe, always visible), and right of it a tab strip, one same-origin
 * iframe per tab and a start page when no tab is active. Canvas tabs run chatless; this page
 * plays the part of the desktop main process and routes the canvas link between the chat frame
 * and the canvas frames (ShellRouter). Must not import App, Pixi, the scene stores or the chat:
 * the editor and the chat run inside the frames, never in this chunk.
 */
export default function WorkspacePage() {
  // The desktop shell has its own tabs; there the web shell is never used.
  if (typeof window !== "undefined" && window.penDesktop) return <Navigate to="/app" replace />;
  return <WorkspaceShell />;
}

function WorkspaceShell() {
  const [state, dispatch] = useReducer(tabsReducer, undefined, () => loadTabsState());
  const framesRef = useRef<Map<string, HTMLIFrameElement>>(new Map());
  const closingRef = useRef<Set<string>>(new Set());
  /** Tabs whose last close attempt failed to save: a close that fails to save again discards them. */
  const discardRef = useRef<Set<string>>(new Set());
  const panelRef = useRef<HTMLIFrameElement>(null);
  const routerRef = useRef<ShellRouter | null>(null);
  const tabsRef = useRef<WorkspaceTab[]>(state.tabs);
  useEffect(() => {
    tabsRef.current = state.tabs;
  }, [state.tabs]);

  useEffect(() => {
    saveTabsState(state);
  }, [state]);

  const active = state.tabs.find((t) => t.id === state.activeTabId) ?? null;
  useEffect(() => {
    document.title = active ? `Sideform – ${tabTitle(active)}` : "Sideform";
  }, [active]);

  const rename = useCallback((kind: TabKind, itemId: string, title: string | undefined) => {
    if (title) dispatch({ type: "rename", kind, itemId, title });
  }, []);

  const refreshTitles = useCallback((isCancelled: () => boolean = () => false) => {
    try {
      for (const d of listDocs()) rename("doc", d.id, d.title);
      for (const w of listWorkflows()) rename("workflow", w.id, w.title);
    } catch {
      /* ignore */
    }
    void webCanvasStore
      .list()
      .then((res) => {
        if (isCancelled() || !("canvases" in res)) return;
        for (const c of res.canvases) rename("canvas", c.id, c.title);
      })
      .catch(() => {});
  }, [rename]);

  // Frames change their own item (doc list, workflow select, back/forward, canvas fork) with
  // history calls that fire no load event: follow them by polling their location.
  useEffect(() => {
    const timer = setInterval(() => {
      let rebound = false;
      for (const tab of tabsRef.current) {
        if (tab.kind === "settings") continue;
        try {
          const loc = framesRef.current.get(tab.id)?.contentWindow?.location;
          if (!loc) continue;
          const itemId = itemIdFromLocation(tab.kind, stripBase(loc.pathname), loc.search);
          if (itemId && itemId !== tab.itemId) {
            dispatch({ type: "rebind", tabId: tab.id, itemId });
            rebound = true;
          }
        } catch {
          /* frame not reachable or mid-navigation */
        }
      }
      if (rebound) refreshTitles();
    }, REBIND_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshTitles]);

  // Titles and deletions from the stores (this page and the frames, through their channels).
  useEffect(() => {
    const offs = [
      subscribeWebCanvases((msg) => {
        if (msg.deleted) dispatch({ type: "closeItem", kind: "canvas", itemId: msg.id });
        else rename("canvas", msg.id, msg.title);
      }),
      subscribeDocs((change) => {
        if (change.deleted) dispatch({ type: "closeItem", kind: "doc", itemId: change.id });
        else rename("doc", change.id, change.doc?.title);
      }),
      subscribeWorkflows((change) => {
        if (change.deleted) dispatch({ type: "closeItem", kind: "workflow", itemId: change.id });
        else rename("workflow", change.id, change.workflow?.title);
      }),
    ];
    // Restored tabs carry the title from the last session; refresh them once.
    let cancelled = false;
    refreshTitles(() => cancelled);
    return () => {
      cancelled = true;
      offs.forEach((off) => off());
    };
  }, [refreshTitles, rename]);

  const openItem = useCallback((kind: TabKind, itemId: string | null, title: string) => {
    dispatch({ type: "open", tabId: makeTabId(), kind, itemId, title });
  }, []);

  /**
   * Opens (or brings forward) the tab of an item for the agent: mounted, in front, no keyboard focus.
   * The reducer resolves an existing item's tab, so this id only matters for a new canvas (never deduped).
   */
  const openForAgent = useCallback((kind: TabKind, itemId: string | null, title: string, section?: SettingsSection): string => {
    const tabId = makeTabId();
    dispatch({ type: "open", tabId, kind, itemId, title, section, agent: true });
    return tabId;
  }, []);

  // The router must listen before any frame loads: a layout effect runs inside the commit that
  // inserts the iframes, before the browser starts them.
  useLayoutEffect(() => {
    const bringForward = (tabId: string) => dispatch({ type: "focus", tabId, agent: true });
    const router = new ShellRouter({
      postToPanel: (msg) => panelRef.current?.contentWindow?.postMessage(wire(msg), window.location.origin),
      postToTab: (tabId, msg) => framesRef.current.get(tabId)?.contentWindow?.postMessage(wire(msg), window.location.origin),
      // The agent's tab comes forward so the user sees it open, and takes no keyboard focus (the reducer's `agent` flag).
      openCanvasTab: () => openForAgent("canvas", newCanvasId(), UNTITLED_CANVAS_TITLE),
      wakeTab: bringForward,
      activateTab: bringForward,
      openDoc: (id): ItemResult => {
        const meta = isValidItemId(id) ? listDocs().find((d) => d.id === id) : undefined;
        if (!meta) return { ok: false, error: "The document does not exist." };
        openForAgent("doc", id, meta.title);
        return { ok: true };
      },
      openWorkflow: (id): ItemResult => {
        const meta = isValidItemId(id) ? listWorkflows().find((w) => w.id === id) : undefined;
        if (!meta) return { ok: false, error: "The workflow does not exist." };
        openForAgent("workflow", id, meta.title);
        return { ok: true };
      },
      openSettings: (section): ItemResult => {
        const known = SETTINGS_SECTIONS.find((s) => s === section);
        const settings = tabsRef.current.find((t) => t.kind === "settings");
        const win = settings ? framesRef.current.get(settings.id)?.contentWindow : null;
        // A loaded Settings frame follows an event; one that is not mounted yet reads the section from its URL.
        if (win && known) win.dispatchEvent(new (win as Window & typeof globalThis).CustomEvent(SETTINGS_SECTION_EVENT, { detail: known }));
        openForAgent("settings", null, "Settings", win ? undefined : known);
        return { ok: true };
      },
      now: () => Date.now(),
    });
    routerRef.current = router;
    const onMessage = (event: MessageEvent) => {
      // Both checks matter: origin says which site, source says which of our frames.
      if (event.origin !== window.location.origin || !isWireMessage(event.data) || !event.source) return;
      // Cheapest checks first: this runs for every streamed tool frame.
      if (event.source === panelRef.current?.contentWindow) {
        router.handle({ from: "panel" }, event.data);
        return;
      }
      for (const [id, el] of framesRef.current) {
        if (el.contentWindow !== event.source) continue;
        const kind = tabsRef.current.find((t) => t.id === id)?.kind;
        if (kind) router.handle({ from: "tab", tabId: id, kind }, event.data);
        return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      router.dispose();
      routerRef.current = null;
    };
  }, [openForAgent]);

  useEffect(() => {
    routerRef.current?.syncTabs(
      state.tabs.map((t) => ({ id: t.id, kind: t.kind, title: tabTitle(t) })),
      state.activeTabId,
    );
  }, [state.tabs, state.activeTabId]);

  const newItem = useCallback(
    (kind: RecentKind) => {
      try {
        if (kind === "canvas") {
          openItem("canvas", newCanvasId(), UNTITLED_CANVAS_TITLE);
        } else if (kind === "doc") {
          const doc = createDoc({ title: DEFAULT_DOC_TITLE }, "editor");
          openItem("doc", doc.id, doc.title);
        } else {
          const wf = createWorkflow({ title: DEFAULT_WORKFLOW_TITLE, steps: [{ id: newStepId(), text: "" }] }, "editor");
          openItem("workflow", wf.id, wf.title);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [openItem],
  );

  const closeTab = useCallback(
    async (tabId: string) => {
      if (closingRef.current.has(tabId)) return;
      closingRef.current.add(tabId);
      try {
        const flush = framesRef.current.get(tabId)?.contentWindow?.penCanvasFlush;
        let saved = true;
        if (flush) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let result: boolean | void | typeof TIMED_OUT = undefined;
          try {
            result = await Promise.race([
              Promise.resolve(flush()),
              new Promise<typeof TIMED_OUT>((resolve) => {
                timer = setTimeout(() => resolve(TIMED_OUT), FLUSH_CAP_MS);
              }),
            ]);
          } catch {
            /* a throwing flush must not keep the tab open */
          } finally {
            clearTimeout(timer);
          }
          saved = !(result === false || result === TIMED_OUT);
        }
        if (!saved && !discardRef.current.has(tabId)) {
          // Unsaved work: keep the tab and mark it. A close that fails again discards it.
          discardRef.current.add(tabId);
          toast.error(UNSAVED_CLOSE_MESSAGE);
          return;
        }
        discardRef.current.delete(tabId);
        dispatch({ type: "close", tabId });
      } finally {
        closingRef.current.delete(tabId);
      }
    },
    [],
  );

  const onNew = (choice: NewTabChoice) => {
    if (choice === "start") dispatch({ type: "home" });
    else newItem(choice);
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-surface-base text-[13px] text-text-muted sm:flex-row">
      {/* One element for both layouts (CSS order, not a move): a resize must never reload the chat.
          Below 640px the tab area is on top and the chat below, half the height each. */}
      <div className="order-2 mr-2 mb-2 ml-2 min-h-0 flex-1 overflow-hidden rounded-xl bg-surface-panel sm:order-1 sm:mt-2 sm:mr-0 sm:max-w-[50%] sm:flex-none sm:basis-(--agent-panel-width)" style={{ "--agent-panel-width": `${AGENT_PANEL_WIDTH}px` } as CSSProperties}>
        <iframe
          ref={panelRef}
          title="Sideform Agent"
          src={appHref("/agent")}
          data-agent-panel
          className="size-full border-0 bg-surface-panel"
        />
      </div>
      <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col sm:order-2">
        <TabStrip
          tabs={state.tabs}
          activeTabId={state.activeTabId}
          onSelect={(tabId) => dispatch({ type: "focus", tabId })}
          onClose={(tabId) => void closeTab(tabId)}
          onHome={() => dispatch({ type: "home" })}
          onNew={onNew}
          onSettings={() => openItem("settings", null, "Settings")}
        />
        <div className="relative mr-2 mb-2 ml-2 min-h-0 flex-1 overflow-hidden rounded-xl bg-surface-panel">
          <TabFrames tabs={state.tabs} activeTabId={state.activeTabId} framesRef={framesRef} mountIds={state.mountIds} focusFrame={state.focusFrame} />
          {state.activeTabId === null && (
            <StartPage
              onNew={newItem}
              onOpen={(item: RecentItem) => openItem(item.kind, item.id, item.title)}
              onBeforeDelete={(item: RecentItem) => dispatch({ type: "closeItem", kind: item.kind, itemId: item.id })}
            />
          )}
        </div>
      </div>
      <ToasterBase theme={document.documentElement.classList.contains("dark") ? "dark" : "light"} />
    </div>
  );
}
