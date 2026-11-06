import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { FileTextIcon, GearIcon, PaintBrushIcon, PlusIcon, SidebarSimpleIcon, TreeStructureIcon } from "@/components/icons";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { tabTitle, type WorkspaceTab } from "@/lib/workspace/tabsModel";

import { canAnimate, isSecondaryClick, useTabDrag } from "./useTabDrag";
import "./tabStrip.css";

const KIND_ICONS = {
  canvas: PaintBrushIcon,
  doc: FileTextIcon,
  workflow: TreeStructureIcon,
  settings: GearIcon,
} as const;

export type NewTabChoice = "canvas" | "doc" | "workflow";

interface TabStripProps {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onHome: () => void;
  onNew: (choice: NewTabChoice) => void;
  onSettings: () => void;
  /** Drag to reorder: put the tab before `beforeId` (null = at the end). */
  onMove?: (tabId: string, beforeId: string | null) => void;
  panelCollapsed?: boolean;
  onTogglePanel?: () => void;
}

interface Ghost {
  key: string;
  tab: WorkspaceTab;
  index: number;
  width: number;
  active: boolean;
}

const NOOP_MOVE = () => {};
const EASE_OUT = "cubic-bezier(0.33, 1, 0.68, 1)";
const EASE_IN = "cubic-bezier(0.32, 0, 0.67, 0)";

export function TabStrip({ tabs, activeTabId, onSelect, onClose, onHome, onNew, onSettings, onMove = NOOP_MOVE, panelCollapsed = false, onTogglePanel }: TabStripProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const prevRef = useRef<{ tabs: WorkspaceTab[]; active: string | null } | null>(null);
  const widthsRef = useRef<Map<string, number>>(new Map());
  const activeRef = useRef(activeTabId);
  // Roving tabindex: the active tab, else the first one, is the tab stop.
  const stopId = tabs.some((t) => t.id === activeTabId) ? activeTabId : (tabs[0]?.id ?? null);
  const startDrag = useTabDrag(
    listRef,
    tabs.map((t) => t.id),
    onMove,
  );

  // A tab selected from elsewhere (new tab, rebind, close neighbour) may sit outside the strip's scroll area.
  useEffect(() => {
    if (!activeTabId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
    if (typeof el?.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  // Motion: a new tab grows in, a closed one stays as a ghost at its old index and shrinks away.
  // Nothing on first render, under reduced motion, or without element.animate.
  useLayoutEffect(() => {
    activeRef.current = activeTabId;
    const before = prevRef.current;
    prevRef.current = { tabs, active: activeTabId };
    const list = listRef.current;
    if (!list) return;
    if (before && canAnimate(list)) {
      const had = new Set(before.tabs.map((t) => t.id));
      const has = new Set(tabs.map((t) => t.id));
      for (const tab of tabs) {
        if (had.has(tab.id)) continue;
        const el = list.querySelector<HTMLElement>(`:scope > [data-ws-tab="${tab.id}"]`);
        if (!el) continue;
        const w = el.getBoundingClientRect().width;
        widthsRef.current.set(tab.id, w); // known now: the measure loop skips tabs that are entering
        el.classList.add("entering");
        const anim = el.animate(
          [{ opacity: 0, width: "0px", minWidth: "0px", paddingLeft: "0px", paddingRight: "0px" }, { opacity: 1, width: `${w}px`, minWidth: `${w}px` }],
          { duration: 180, easing: EASE_OUT },
        );
        anim.onfinish = anim.oncancel = () => {
          el.classList.remove("entering");
          // The first scroll ran while the tab was still width 0: scroll again at full width.
          if (tab.id === activeRef.current && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", inline: "nearest" });
        };
      }
      const gone = before.tabs
        .map((tab, index) => ({ tab, index }))
        .filter(({ tab }) => !has.has(tab.id) && widthsRef.current.has(tab.id));
      if (gone.length > 0) {
        // Read the widths now: the updater runs later, after they are dropped below.
        const added = gone.map(({ tab, index }) => ({
          key: `${tab.id}:${performance.now()}`,
          tab,
          index,
          width: widthsRef.current.get(tab.id) ?? 0,
          active: tab.id === before.active,
        }));
        setGhosts((g) => [...g, ...added]);
      }
    }
    const open = new Set(tabs.map((t) => t.id));
    for (const id of widthsRef.current.keys()) if (!open.has(id)) widthsRef.current.delete(id);
    for (const el of list.querySelectorAll<HTMLElement>(":scope > [data-ws-tab]")) {
      if (!el.classList.contains("entering")) widthsRef.current.set(el.dataset.wsTab ?? "", el.getBoundingClientRect().width);
    }
  }, [tabs, activeTabId]);

  const dropGhost = useCallback((key: string) => setGhosts((g) => g.filter((x) => x.key !== key)), []);

  const focusTab = (tabId: string | undefined) => {
    if (!tabId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${tabId}"]`)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    let target: number | null = null;
    if (e.key === "ArrowRight") target = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft") target = index === 0 ? last : index - 1;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = last;
    else if (e.key === "Delete") {
      e.preventDefault();
      onClose(tabs[index].id);
      return;
    }
    if (target === null) return;
    e.preventDefault();
    focusTab(tabs[target]?.id);
  };

  const rows: Array<{ tab: WorkspaceTab; index: number } | { ghost: Ghost }> = tabs.map((tab, index) => ({ tab, index }));
  for (const ghost of [...ghosts].sort((a, b) => a.index - b.index)) rows.splice(Math.min(ghost.index, rows.length), 0, { ghost });

  return (
    <div className="ws-row" data-panel-collapsed={panelCollapsed ? "" : undefined}>
      <div className="ws-nav">
        <button
          type="button"
          aria-label={panelCollapsed ? "Show agent panel" : "Hide agent panel"}
          title={`${panelCollapsed ? "Show" : "Hide"} agent panel (Cmd/Ctrl+Alt+B)`}
          aria-pressed={!panelCollapsed}
          onClick={onTogglePanel}
          className="ws-btn"
        >
          <SidebarSimpleIcon aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Start page"
          title="Start page"
          aria-pressed={activeTabId === null}
          onClick={onHome}
          className="ws-btn"
        >
          <HomeGlyph />
        </button>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          aria-pressed={tabs.some((t) => t.kind === "settings" && t.id === activeTabId)}
          onClick={onSettings}
          className="ws-btn"
        >
          <GearIcon aria-hidden />
        </button>
      </div>

      <div ref={listRef} role="tablist" aria-label="Open tabs" className="ws-tab-list">
        {rows.map((row) => {
          if ("ghost" in row) return <TabGhost key={`ghost-${row.ghost.key}`} ghost={row.ghost} onDone={dropGhost} />;
          const { tab, index } = row;
          const Icon = KIND_ICONS[tab.kind];
          const active = tab.id === activeTabId;
          const title = tabTitle(tab);
          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger
                render={
                  <div
                    data-ws-tab={tab.id}
                    className={cn("ws-tab", active && "is-active")}
                    onMouseDown={(e) => {
                      if (isSecondaryClick(e)) return;
                      // Keep the keyboard focus where it is (the frame, once it took it): the button must not steal it.
                      e.preventDefault();
                      onSelect(tab.id);
                    }}
                    onPointerDown={(e) => startDrag(e, tab.id)}
                  />
                }
              >
                <button
                  type="button"
                  role="tab"
                  id={`ws-tab-${tab.id}`}
                  data-tab-id={tab.id}
                  aria-selected={active}
                  tabIndex={tab.id === stopId ? 0 : -1}
                  title={title}
                  // Mouse activation is on mousedown. A click with no pointer (detail 0) is the keyboard.
                  onClick={(e) => {
                    if (e.detail === 0) onSelect(tab.id);
                  }}
                  onKeyDown={(e) => onKeyDown(e, index)}
                  className="ws-tab-btn"
                >
                  <span className="ws-tab-icon">
                    <Icon aria-hidden />
                  </span>
                  <span className="ws-tab-title">{title}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Close ${title}`}
                  tabIndex={-1}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => onClose(tab.id)}
                  className="ws-tab-close"
                />
              </ContextMenuTrigger>
              <ContextMenuContent className="w-40">
                <ContextMenuItem onClick={() => onClose(tab.id)}>Close Tab</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger aria-label="New tab" title="New Tab" className="ws-btn">
          <PlusIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => onNew("canvas")}>
            <PaintBrushIcon aria-hidden /> New Canvas Tab
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNew("doc")}>
            <FileTextIcon aria-hidden /> New Document
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNew("workflow")}>
            <TreeStructureIcon aria-hidden /> New Workflow
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** A closed tab, inert and out of the accessibility tree, shrinking away at its old place. */
function TabGhost({ ghost, onDone }: { ghost: Ghost; onDone: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { tab, width, key } = ghost;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") {
      onDone(key);
      return;
    }
    const anim = el.animate(
      [
        { opacity: 1, width: `${width}px`, minWidth: `${width}px` },
        { opacity: 0, width: "0px", minWidth: "0px", paddingLeft: "0px", paddingRight: "0px" },
      ],
      { duration: 160, easing: EASE_IN, fill: "forwards" },
    );
    anim.onfinish = anim.oncancel = () => onDone(key);
    return () => {
      anim.onfinish = anim.oncancel = null;
      anim.finished.catch(() => {});
      anim.cancel();
    };
  }, [key, width, onDone]);
  const Icon = KIND_ICONS[tab.kind];
  return (
    <div ref={ref} aria-hidden="true" inert className={cn("ws-tab-ghost", ghost.active && "is-active")}>
      <span className="ws-tab-btn">
        <span className="ws-tab-icon">
          <Icon aria-hidden />
        </span>
        <span className="ws-tab-title">{tabTitle(tab)}</span>
      </span>
      <span className="ws-tab-close" />
    </div>
  );
}

// No House glyph in the pen icon set: a plain outlined house in the same 16px grid and stroke.
function HomeGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M2.5 7.25 8 2.5l5.5 4.75V13a.5.5 0 0 1-.5.5H9.5V9.5h-3v4H3a.5.5 0 0 1-.5-.5Z" />
    </svg>
  );
}
