import { useEffect, useRef, useState, type MutableRefObject } from "react";

import { tabTitle, tabUrl, type WorkspaceTab } from "@/lib/workspace/tabsModel";

interface TabFramesProps {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  /** The shell reads the frames from here to flush a tab before it closes. */
  framesRef: MutableRefObject<Map<string, HTMLIFrameElement>>;
  /** Tabs whose frame must mount even though they are not active (the agent opened or woke them). */
  mountIds?: readonly string[];
  /**
   * false while the active tab was changed on the agent's behalf: the frame then does not take
   * keyboard focus (the chat composer keeps it). Default true.
   */
  focusFrame?: boolean;
}

/**
 * One same-origin iframe per tab, all stacked. A frame mounts the first time its tab is active or
 * requested (`mountIds`) and stays mounted until the tab closes. A hidden frame uses `visibility`, never `display:none`: that would give the Pixi
 * canvas a zero size and stop its rAF loop.
 */
export function TabFrames({ tabs, activeTabId, framesRef, mountIds, focusFrame = true }: TabFramesProps) {
  // Mounted frames and the URL each was first given. A frame changes its own item with history
  // calls; `src` must not follow (that would reload it). A remount after a page reload starts from
  // the tab as it is then.
  const [mounted, setMounted] = useState<Map<string, string>>(() => {
    const first = tabs.find((t) => t.id === activeTabId);
    return new Map(first ? [[first.id, tabUrl(first)]] : []);
  });
  // The active tab and every explicitly requested one mount in the same render pass, so two opens
  // batched into one update both get their frame. A closed tab's entry goes with it.
  const wanted = tabs.filter((t) => !mounted.has(t.id) && (t.id === activeTabId || mountIds?.includes(t.id)));
  const stale = [...mounted.keys()].filter((id) => !tabs.some((t) => t.id === id));
  if (wanted.length > 0 || stale.length > 0) {
    const next = new Map(mounted);
    for (const id of stale) next.delete(id);
    for (const t of wanted) next.set(t.id, tabUrl(t));
    setMounted(next);
  }

  // Keyboard shortcuts must reach the editor of the tab that just came forward (once per change of
  // the active tab), unless the agent brought it forward.
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeTabId || focusedRef.current === activeTabId) {
      if (!activeTabId) focusedRef.current = null;
      return;
    }
    focusedRef.current = activeTabId;
    if (focusFrame) framesRef.current.get(activeTabId)?.contentWindow?.focus();
  }, [activeTabId, focusFrame, framesRef]);

  return (
    <>
      {/* Sorted by id, never by tab order: a reorder must not make React move an iframe node (a moved iframe reloads). */}
      {tabs
        .filter((t) => mounted.has(t.id))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <iframe
              key={tab.id}
              ref={(el) => {
                if (el) framesRef.current.set(tab.id, el);
                else framesRef.current.delete(tab.id);
              }}
              name={`pen-tab-${tab.id}`}
              title={tabTitle(tab)}
              src={mounted.get(tab.id)}
              className="absolute inset-0 size-full border-0 bg-surface-panel"
              style={{ visibility: active ? "visible" : "hidden", pointerEvents: active ? undefined : "none" }}
            />
          );
        })}
    </>
  );
}
