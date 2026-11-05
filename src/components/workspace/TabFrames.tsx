import { useEffect, useState, type MutableRefObject } from "react";

import { tabTitle, tabUrl, type WorkspaceTab } from "@/lib/workspace/tabsModel";

interface TabFramesProps {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  /** The shell reads the frames from here to flush a tab before it closes. */
  framesRef: MutableRefObject<Map<string, HTMLIFrameElement>>;
}

/**
 * One same-origin iframe per tab, all stacked. A frame mounts the first time its tab is active and
 * stays mounted. A hidden frame uses `visibility`, never `display:none`: that would give the Pixi
 * canvas a zero size and stop its rAF loop.
 */
export function TabFrames({ tabs, activeTabId, framesRef }: TabFramesProps) {
  // Mounted frames and the URL each was first given. A frame changes its own item with history
  // calls; `src` must not follow (that would reload it). A remount after a page reload starts from
  // the tab as it is then.
  const [mounted, setMounted] = useState<Map<string, string>>(() => {
    const first = tabs.find((t) => t.id === activeTabId);
    return new Map(first ? [[first.id, tabUrl(first)]] : []);
  });
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (activeTab && !mounted.has(activeTab.id)) setMounted(new Map(mounted).set(activeTab.id, tabUrl(activeTab)));

  // Keyboard shortcuts must reach the editor of the tab that just came forward.
  useEffect(() => {
    if (!activeTabId) return;
    framesRef.current.get(activeTabId)?.contentWindow?.focus();
  }, [activeTabId, framesRef]);

  return (
    <>
      {tabs
        .filter((t) => mounted.has(t.id))
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
