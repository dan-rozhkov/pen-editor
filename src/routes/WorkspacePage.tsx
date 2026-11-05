import { useCallback, useEffect, useReducer, useRef } from "react";
import { Navigate } from "react-router";
import { toast } from "sonner";

import { ToasterBase } from "@/components/ui/ToasterBase";

import { StartPage } from "@/components/workspace/StartPage";
import { TabFrames } from "@/components/workspace/TabFrames";
import { TabStrip, type NewTabChoice } from "@/components/workspace/TabStrip";
import { stripBase } from "@/lib/auth/paths";
import { subscribeWebCanvases, webCanvasStore } from "@/lib/canvases/webCanvasStore";
import { DEFAULT_DOC_TITLE, createDoc, listDocs, subscribeDocs } from "@/lib/docs/docStore";
import { DEFAULT_WORKFLOW_TITLE, createWorkflow, listWorkflows, newStepId, subscribeWorkflows } from "@/lib/workflows/workflowStore";
import type { RecentItem, RecentKind } from "@/lib/workspace/recent";
import {
  UNTITLED_CANVAS_TITLE,
  itemIdFromLocation,
  loadTabsState,
  makeTabId,
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

/**
 * "/workspace": the browser counterpart of the desktop tab bar. A tab strip, one same-origin
 * iframe per tab and a start page when no tab is active. Must not import App, Pixi, the scene
 * stores or the chat: the editor runs inside the frames, never in this chunk.
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
    <div className="fixed inset-0 flex flex-col bg-surface-base text-[13px] text-text-muted">
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
        <TabFrames tabs={state.tabs} activeTabId={state.activeTabId} framesRef={framesRef} />
        {state.activeTabId === null && (
          <StartPage
            onNew={newItem}
            onOpen={(item: RecentItem) => openItem(item.kind, item.id, item.title)}
            onBeforeDelete={(item: RecentItem) => dispatch({ type: "closeItem", kind: item.kind, itemId: item.id })}
          />
        )}
      </div>
      <ToasterBase theme={document.documentElement.classList.contains("dark") ? "dark" : "light"} />
    </div>
  );
}
