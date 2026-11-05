import { useEffect, useRef } from "react";

import { FileTextIcon, GearIcon, PaintBrushIcon, PlusIcon, TreeStructureIcon, XIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { tabTitle, type WorkspaceTab } from "@/lib/workspace/tabsModel";

const KIND_ICONS = {
  canvas: PaintBrushIcon,
  doc: FileTextIcon,
  workflow: TreeStructureIcon,
  settings: GearIcon,
} as const;

export type NewTabChoice = "canvas" | "doc" | "workflow" | "start";

interface TabStripProps {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onHome: () => void;
  onNew: (choice: NewTabChoice) => void;
  onSettings: () => void;
}

const GHOST_BTN =
  "flex size-7 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function TabStrip({ tabs, activeTabId, onSelect, onClose, onHome, onNew, onSettings }: TabStripProps) {
  const listRef = useRef<HTMLDivElement>(null);
  // Roving tabindex: the active tab, else the first one, is the tab stop.
  const stopId = tabs.some((t) => t.id === activeTabId) ? activeTabId : (tabs[0]?.id ?? null);

  // A tab selected from elsewhere (new tab, rebind, close neighbour) may sit outside the strip's scroll area.
  useEffect(() => {
    if (!activeTabId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
    if (typeof el?.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

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

  return (
    <div className="flex h-[38px] shrink-0 items-center gap-0.5 bg-surface-base px-2 py-[5px]">
      <button
        type="button"
        aria-label="Start page"
        title="Start page"
        aria-pressed={activeTabId === null}
        onClick={onHome}
        className={cn(GHOST_BTN, activeTabId === null && "bg-surface-hover text-text-primary")}
      >
        <HomeGlyph />
      </button>

      <div
        ref={listRef}
        role="tablist"
        aria-label="Open tabs"
        className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab, index) => {
          const Icon = KIND_ICONS[tab.kind];
          const active = tab.id === activeTabId;
          const title = tabTitle(tab);
          return (
            <div
              key={tab.id}
              role="presentation"
              className={cn(
                "group/tab relative flex h-7 max-w-[200px] min-w-[96px] shrink-0 items-center rounded-lg text-text-muted",
                active ? "bg-surface-hover text-text-primary" : "hover:bg-surface-hover/60 hover:text-text-primary",
              )}
            >
              <button
                type="button"
                role="tab"
                id={`ws-tab-${tab.id}`}
                data-tab-id={tab.id}
                aria-selected={active}
                tabIndex={tab.id === stopId ? 0 : -1}
                title={title}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(e) => onKeyDown(e, index)}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pr-7 pl-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="block min-w-0 flex-1 truncate">{title}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${title}`}
                tabIndex={-1}
                onClick={() => onClose(tab.id)}
                className={cn(
                  "absolute top-1 right-1 flex size-5 items-center justify-center rounded-[4px] bg-surface-hover text-text-muted hover:text-text-primary",
                  active ? "visible" : "invisible group-hover/tab:visible group-focus-within/tab:visible",
                )}
              >
                <XIcon className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger aria-label="New tab" title="New tab" className={GHOST_BTN}>
          <PlusIcon className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={() => onNew("canvas")}>
            <PaintBrushIcon aria-hidden /> New canvas
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNew("doc")}>
            <FileTextIcon aria-hidden /> New document
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNew("workflow")}>
            <TreeStructureIcon aria-hidden /> New workflow
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onNew("start")}>Start page</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="min-w-0 flex-1" />

      <button
        type="button"
        aria-label="Settings"
        title="Settings"
        onClick={onSettings}
        className={cn(GHOST_BTN, tabs.some((t) => t.kind === "settings" && t.id === activeTabId) && "bg-surface-hover text-text-primary")}
      >
        <GearIcon className="size-4" aria-hidden />
      </button>
    </div>
  );
}

// No House glyph in the pen icon set: a plain outlined house in the same 16px grid and stroke.
function HomeGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M2.5 7.25 8 2.5l5.5 4.75V13a.5.5 0 0 1-.5.5H9.5V9.5h-3v4H3a.5.5 0 0 1-.5-.5Z" />
    </svg>
  );
}
