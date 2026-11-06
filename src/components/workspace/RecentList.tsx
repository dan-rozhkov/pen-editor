import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ALL_KINDS,
  RECENT_KIND_LABELS,
  RECENT_MODIFIED_LABELS,
  filterRecent,
  formatRelativeTime,
  type RecentItem,
  type RecentKind,
  type RecentKinds,
  type RecentModified,
} from "@/lib/workspace/recent";

const KIND_ICONS = { canvas: PaintBrushIcon, doc: FileTextIcon, workflow: TreeStructureIcon } as const;
const KIND_MENU_LABELS: Record<RecentKind, string> = { canvas: "Canvases", doc: "Documents", workflow: "Workflows" };
const KIND_ORDER: RecentKind[] = ["canvas", "doc", "workflow"];
const MODIFIED_ORDER: RecentModified[] = ["any", "today", "7d", "30d"];
const VISIBLE_ROWS = 8;

const keyOf = (item: Pick<RecentItem, "kind" | "id">) => `${item.kind}:${item.id}`;
const itemsLabel = (n: number) => (n === 1 ? "1 item" : `${n} items`);

interface RecentListProps {
  items: RecentItem[];
  onOpen: (item: RecentItem) => void;
  /** Called after the user confirmed. Resolves with the items that could not be deleted. */
  onDelete: (items: RecentItem[]) => Promise<RecentItem[]>;
}

export function RecentList({ items, onOpen, onDelete }: RecentListProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<RecentKinds>(ALL_KINDS);
  const [modified, setModified] = useState<RecentModified>("any");
  const [expanded, setExpanded] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The count the dialog was opened for: the live selection may change or empty while it closes.
  const [confirmCount, setConfirmCount] = useState(0);
  // The relative times age while the page stays open.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const lastToggled = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const baseHeight = useRef(0);
  // Focus that must wait for the next commit (the control is hidden until then).
  const focusNext = useRef<RefObject<HTMLElement | null> | null>(null);
  useEffect(() => {
    focusNext.current?.current?.focus();
    focusNext.current = null;
  });

  const kindsDefault = kinds.canvas && kinds.doc && kinds.workflow;
  const filterDefault = kindsDefault && modified === "any";
  const filtering = query.trim() !== "" || !filterDefault;
  const matches = useMemo(() => filterRecent(items, query, kinds, modified, now), [items, query, kinds, modified, now]);
  // While a search or filter is on, every match is listed (no row cap).
  const shown = expanded || filtering ? matches : matches.slice(0, VISIBLE_ROWS);
  const shownKeys = shown.map(keyOf);
  // Only rows that are listed count as selected: one that left the list (filtered out, aged out of
  // the time filter, deleted elsewhere) must not be deleted unseen.
  const selected = useMemo(() => {
    const live = new Set(shownKeys);
    return new Set([...picked].filter((key) => live.has(key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, shown]);
  const selecting = selected.size > 0;
  const allSelected = matches.length > 0 && matches.every((item) => selected.has(keyOf(item)));

  // While a search or filter is on, the list block keeps the height of the default view: the page is
  // vertically centred, so a shrinking block would make the whole page jump.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (filtering || searchOpen) {
      el.style.minHeight = `${baseHeight.current}px`;
    } else {
      el.style.minHeight = "";
      baseHeight.current = el.offsetHeight;
    }
  });

  const resetSelection = useCallback(() => {
    setNote("");
    setPicked(new Set());
    lastToggled.current = null;
    // The selection bar hides with the selection, taking focus with it.
    focusNext.current = filterRef;
  }, []);

  // A global Esc: with no search field focused it clears the selection (not while the dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || confirmOpen || e.target === searchRef.current) return;
      if (selecting) resetSelection();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting, confirmOpen, resetSelection]);

  // A changed search or filter starts a new result set: the selection does not carry over.
  const refilter = (apply: () => void) => {
    apply();
    resetSelection();
    focusNext.current = null; // typing in the search field or the filter menu keeps its own focus
  };
  const closeSearch = () => {
    setSearchOpen(false);
  };
  const clearFilters = () => {
    refilter(() => {
      setQuery("");
      setKinds(ALL_KINDS);
      setModified("any");
    });
  };

  const toggleKey = (key: string, range: boolean) => {
    setNote("");
    const on = !selected.has(key);
    const from = range && lastToggled.current !== null ? shownKeys.indexOf(lastToggled.current) : -1;
    const to = shownKeys.indexOf(key);
    const next = new Set(selected);
    const set = (k: string) => (on ? next.add(k) : next.delete(k));
    if (from !== -1 && to !== -1) {
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) set(shownKeys[i]);
    } else set(key);
    lastToggled.current = key;
    setPicked(next);
  };

  const runDelete = () => {
    if (deleting || !selecting) return;
    const chosen = items.filter((item) => selected.has(keyOf(item)));
    setDeleting(true);
    onDelete(chosen)
      .then((failed) => {
        // Only the deleted keys leave the selection; failed items stay selected.
        const failedKeys = new Set(failed.map(keyOf));
        const deletedKeys = chosen.map(keyOf).filter((key) => !failedKeys.has(key));
        // Functional: the selection may have changed while the deletion ran.
        setPicked((prev) => {
          const next = new Set(prev);
          for (const key of deletedKeys) next.delete(key);
          return next;
        });
        if (lastToggled.current !== null && deletedKeys.includes(lastToggled.current)) lastToggled.current = null;
        setNote(failedKeys.size > 0 ? `Couldn't delete ${itemsLabel(failedKeys.size)}.` : "");
        // Focus the filter button only if the list (and its toolbar) survives the deletion.
        if (failedKeys.size === 0 && items.length > deletedKeys.length) focusNext.current = filterRef;
      })
      .catch(() => setNote("Couldn't delete these items."))
      .finally(() => setDeleting(false));
  };

  const confirmDialog = (
    <ConfirmDeleteDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      name=""
      title={`Delete ${itemsLabel(confirmCount)}?`}
      description={
        confirmCount === 1
          ? "It will be removed from this browser. This can't be undone."
          : "They will be removed from this browser. This can't be undone."
      }
      onConfirm={runDelete}
    />
  );

  // Keep the dialog mounted when the last item is gone, so it can finish closing.
  if (items.length === 0) return confirmDialog;

  const onRowsKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>(".ws-recent-row") ?? []);
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    const next = rows[at + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <section className={`ws-recent${selecting ? " selecting" : ""}`} aria-labelledby="ws-recent-heading">
      <div className="ws-recent-header">
        <div className="ws-recent-bar" hidden={selecting}>
          <h2 className="ws-recent-heading" id="ws-recent-heading">
            Recent
          </h2>
          <div className="ws-recent-tools">
            <div className="ws-search-wrap" hidden={!searchOpen}>
              <MagnifyingGlassIcon className="ws-search-icon" aria-hidden />
              <input
                ref={searchRef}
                className="ws-search"
                type="search"
                placeholder="Search"
                aria-label="Search"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(e) => refilter(() => setQuery(e.target.value))}
                onBlur={() => {
                  if (query === "") closeSearch();
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  if (query !== "") refilter(() => setQuery(""));
                  else {
                    closeSearch();
                    focusNext.current = searchToggleRef;
                  }
                }}
              />
              <button
                type="button"
                className="ws-search-clear"
                aria-label="Clear search"
                title="Clear search"
                hidden={query === ""}
                onClick={() => {
                  refilter(() => setQuery(""));
                  searchRef.current?.focus();
                }}
              >
                <XIcon className="ws-search-clear-icon" aria-hidden />
              </button>
            </div>
            <button
              ref={searchToggleRef}
              type="button"
              className="ws-tool"
              aria-label="Search"
              title="Search"
              aria-expanded={searchOpen}
              hidden={searchOpen}
              onClick={() => {
                setSearchOpen(true);
                focusNext.current = searchRef;
              }}
            >
              <MagnifyingGlassIcon className="ws-tool-icon" aria-hidden />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                ref={filterRef}
                aria-label="Filter"
                title="Filter"
                className={`ws-tool${filterDefault ? "" : " is-active"}`}
              >
                <FunnelSimpleIcon className="ws-tool-icon" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Type</DropdownMenuLabel>
                  {KIND_ORDER.map((kind) => (
                    <DropdownMenuCheckboxItem
                      key={kind}
                      checked={kinds[kind]}
                      onCheckedChange={(checked) => refilter(() => setKinds((k) => ({ ...k, [kind]: checked })))}
                    >
                      {KIND_MENU_LABELS[kind]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Modified</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={modified}
                    onValueChange={(value) => refilter(() => setModified(value as RecentModified))}
                  >
                    {MODIFIED_ORDER.map((range) => (
                      <DropdownMenuRadioItem key={range} value={range}>
                        {RECENT_MODIFIED_LABELS[range]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={filterDefault} onClick={clearFilters}>
                  Reset filters
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="ws-recent-selbar" hidden={!selecting}>
          <button
            type="button"
            className="ws-tool"
            aria-label="Clear selection"
            title="Clear selection"
            onClick={resetSelection}
          >
            <XIcon className="ws-tool-icon" aria-hidden />
          </button>
          <span className="ws-recent-count" role="status">
            {selected.size} selected
          </span>
          <span className="ws-recent-note" role="status">
            {note}
          </span>
          <button
            type="button"
            className="ws-text-btn"
            hidden={allSelected}
            onClick={() => {
              setNote("");
              // Every match, so list them all: nothing selected may hide behind "Show all".
              setExpanded(true);
              setPicked(new Set([...selected, ...matches.map(keyOf)]));
              focusNext.current = deleteRef;
            }}
          >
            Select all
          </button>
          <button
            ref={deleteRef}
            type="button"
            className="ws-text-btn ws-delete"
            disabled={deleting}
            onClick={() => {
              setConfirmCount(selected.size);
              setConfirmOpen(true);
            }}
          >
            <TrashIcon className="ws-tool-icon" aria-hidden />
            <span>Delete</span>
          </button>
        </div>
      </div>

      <div className="ws-recent-body" ref={bodyRef}>
        <ul className="ws-recent-list" ref={listRef} onKeyDown={onRowsKeyDown}>
          {shown.map((item) => {
            const key = keyOf(item);
            const Icon = KIND_ICONS[item.kind];
            const title = item.title || "Untitled";
            const on = selected.has(key);
            return (
              <li key={key} className={`ws-recent-item${on ? " selected" : ""}`}>
                <input
                  type="checkbox"
                  className="ws-recent-check"
                  aria-label={`Select ${title}`}
                  checked={on}
                  onChange={() => {}}
                  onClick={(e) => toggleKey(key, e.shiftKey)}
                />
                <button
                  type="button"
                  className="ws-recent-row"
                  onClick={(e) => {
                    if (selecting || e.metaKey || e.ctrlKey) toggleKey(key, e.shiftKey && selecting);
                    else onOpen(item);
                  }}
                >
                  <Icon className="ws-recent-icon" aria-hidden />
                  <span className="ws-recent-title">{title}</span>
                  <span className="ws-recent-kind">{RECENT_KIND_LABELS[item.kind]}</span>
                  <span className="ws-recent-time">{formatRelativeTime(item.updatedAt, now)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="ws-recent-empty" hidden={matches.length > 0}>
          <p className="ws-recent-empty-text">No matching files</p>
          <button type="button" className="ws-recent-more" onClick={clearFiltersAndSearch}>
            Clear search and filters
          </button>
        </div>
        <button
          type="button"
          className="ws-recent-more"
          hidden={expanded || filtering || matches.length - VISIBLE_ROWS <= 0}
          onClick={() => {
            setExpanded(true);
            focusNext.current = null;
          }}
        >
          Show all ({matches.length})
        </button>
      </div>

      {confirmDialog}
    </section>
  );

  function clearFiltersAndSearch() {
    closeSearch();
    clearFilters();
    filterRef.current?.focus();
  }
}
