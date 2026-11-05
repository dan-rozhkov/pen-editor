import { useEffect, useMemo, useState } from "react";

import {
  FileTextIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  PaintBrushIcon,
  TrashIcon,
  TreeStructureIcon,
  XIcon,
} from "@/components/icons";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ALL_KINDS,
  RECENT_KIND_LABELS,
  filterRecent,
  formatRelativeTime,
  type RecentItem,
  type RecentKind,
  type RecentKinds,
} from "@/lib/workspace/recent";

const KIND_ICONS = { canvas: PaintBrushIcon, doc: FileTextIcon, workflow: TreeStructureIcon } as const;
const KIND_ORDER: RecentKind[] = ["canvas", "doc", "workflow"];
const VISIBLE_ROWS = 8;

const TOOL_BTN =
  "relative flex size-7 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-surface-hover aria-expanded:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface RecentListProps {
  items: RecentItem[];
  onOpen: (item: RecentItem) => void;
  /** Called after the user confirmed. The caller closes the tab first, then removes the item. */
  onDelete: (item: RecentItem) => void;
}

export function RecentList({ items, onOpen, onDelete }: RecentListProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<RecentKinds>(ALL_KINDS);
  const [expanded, setExpanded] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RecentItem | null>(null);

  const kindsDefault = kinds.canvas && kinds.doc && kinds.workflow;
  const filtering = query.trim() !== "" || !kindsDefault;
  const matches = useMemo(() => filterRecent(items, query, kinds), [items, query, kinds]);
  const shown = expanded ? matches : matches.slice(0, VISIBLE_ROWS);
  // The relative times age while the page stays open.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (items.length === 0) return null;

  const clearFilters = () => {
    setQuery("");
    setKinds(ALL_KINDS);
  };

  return (
    <section className="flex w-full max-w-[840px] flex-none flex-col gap-1.5" aria-labelledby="ws-recent-heading">
      <div className="flex min-h-7 items-center gap-1">
        <h2 id="ws-recent-heading" className="m-0 flex-1 px-2 text-xs font-medium text-text-muted">
          Recent
        </h2>
        {searchOpen && (
          <div className="relative flex w-[200px] items-center">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2 size-4 text-text-muted" aria-hidden />
            <input
              type="search"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              aria-label="Search"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setSearchOpen(false);
                }
              }}
              className="h-7 w-full rounded-control border border-border-default bg-transparent pr-7 pl-[30px] text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {query !== "" && (
              <button
                type="button"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => setQuery("")}
                className="absolute right-[3px] flex size-[22px] items-center justify-center rounded-control-xs text-text-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <XIcon className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          aria-label="Search"
          title="Search"
          aria-expanded={searchOpen}
          onClick={() => {
            if (searchOpen) setQuery("");
            setSearchOpen((v) => !v);
          }}
          className={TOOL_BTN}
        >
          <MagnifyingGlassIcon className="size-4" aria-hidden />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Filter" title="Filter" className={TOOL_BTN}>
            <FunnelSimpleIcon className="size-4" aria-hidden />
            {!kindsDefault && <span aria-hidden className="absolute top-[5px] right-[5px] size-1.5 rounded-full bg-ring" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {KIND_ORDER.map((kind) => (
              <DropdownMenuCheckboxItem
                key={kind}
                checked={kinds[kind]}
                onCheckedChange={(checked) => setKinds((k) => ({ ...k, [kind]: checked }))}
              >
                {RECENT_KIND_LABELS[kind]}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={kindsDefault} onClick={() => setKinds(ALL_KINDS)}>
              Reset filter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {matches.length === 0 && filtering ? (
        <div className="flex flex-col items-start">
          <p className="m-0 px-2 pt-2 text-text-muted">No matching files</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-1 h-9 rounded-control-xl px-2 text-text-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear search and filters
          </button>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {shown.map((item) => {
            const Icon = KIND_ICONS[item.kind];
            const title = item.title || "Untitled";
            return (
              <li key={`${item.kind}:${item.id}`} className="group/row relative flex items-center rounded-control-xl hover:bg-surface-hover focus-within:bg-surface-hover">
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-control-xl px-2 text-left text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon className="size-4 shrink-0 text-text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                  <span className="sr-only">{RECENT_KIND_LABELS[item.kind]}</span>
                  <span className="min-w-[72px] shrink-0 text-right text-text-muted tabular-nums group-hover/row:opacity-0 group-focus-within/row:opacity-0">
                    {formatRelativeTime(item.updatedAt, now)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${title}`}
                  title="Delete"
                  onClick={() => setPendingDelete(item)}
                  className="absolute right-1 flex size-7 items-center justify-center rounded-control text-text-muted opacity-0 hover:bg-surface-active focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100"
                >
                  <TrashIcon className="size-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!expanded && matches.length > VISIBLE_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="h-9 self-start rounded-control-xl px-2 text-text-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show all ({matches.length})
        </button>
      )}

      <ConfirmDeleteDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        name={pendingDelete ? pendingDelete.title || "Untitled" : ""}
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete);
        }}
      />
    </section>
  );
}
