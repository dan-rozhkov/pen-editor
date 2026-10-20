import { useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CaretDownIcon,
  FunnelSimpleIcon,
  FunnelSimpleXIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { skipBaseUiOpen } from "../ui/baseUi";
import { MENU_INPUT, POPOVER_SURFACE } from "../ui/menuSurface";
import { deleteColumn, moveColumn, sortColumn, type columnActions } from "./tableCommands";
import { filterSummary, getColumnFilters, setColumnFilter } from "./tableFilter";
import { place, type Placed } from "./tableGeometry";
import { CHEVRON_WEIGHT } from "@/components/ui/chevron";

export type HeaderMenuKind = "head" | "filter";

interface Props {
  editor: Editor;
  tablePos: number;
  col: number;
  placed: Placed;
  /** The table controls' current menu; this component owns the "head" and "filter" kinds. */
  menu: string | null;
  actions: ReturnType<typeof columnActions> | null;
  setMenu: (next: HeaderMenuKind | null) => void;
  /** Closes the menu only while it is still `kind` (a click on "Filter…" closes the list AND opens the popover). */
  closeIf: (kind: HeaderMenuKind) => void;
  /** Runs a command against the table's current position, then closes the menu. */
  run: (action: (pos: number) => unknown) => () => void;
}

const HEAD_CLASS =
  "absolute z-10 h-auto min-w-0 rounded-sm border border-transparent bg-surface-panel/90 p-0 text-text-muted hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground data-filtered:text-foreground [&_svg:not([class*='size-'])]:size-3.5";

/** A filtered column's funnel is a bare icon: no background at rest, on hover or while its menu is open. */
export const FILTER_ICON_NO_BG =
  "bg-transparent hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent dark:aria-expanded:bg-transparent";

/** The caret button in a header cell: sort, filter, move and delete for that column. */
export function ColumnHeaderMenu({ editor, tablePos, col, placed, menu, actions, setMenu, closeIf, run }: Props) {
  const filtered = getColumnFilters(editor, tablePos)[col] !== undefined;
  return (
    <>
      <DropdownMenu open={menu === "head"} onOpenChange={(open) => !open && closeIf("head")} modal={false}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              aria-label={filtered ? "Column menu, filtered" : "Column menu"}
              data-table-control
              data-filtered={filtered ? "" : undefined}
              className={cn(HEAD_CLASS, filtered && FILTER_ICON_NO_BG)}
              style={place(placed)}
              onPointerDown={skipBaseUiOpen}
              onMouseDown={(event: unknown) => {
                skipBaseUiOpen(event);
                (event as React.MouseEvent).preventDefault();
              }}
              onClick={(event: unknown) => {
                skipBaseUiOpen(event);
                setMenu(menu === "head" ? null : "head");
              }}
            >
              {filtered ? <FunnelSimpleIcon /> : <CaretDownIcon weight={CHEVRON_WEIGHT} />}
            </Button>
          }
        />
        <DropdownMenuContent align="end" side="bottom" finalFocus={false} className="w-auto min-w-44" data-table-control>
          <DropdownMenuItem disabled={!actions?.sort} onClick={run((p) => sortColumn(editor, p, col, "asc"))}>
            <SortAscendingIcon /> Sort ascending
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!actions?.sort} onClick={run((p) => sortColumn(editor, p, col, "desc"))}>
            <SortDescendingIcon /> Sort descending
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!actions?.filter} onClick={() => setMenu("filter")}>
            <FunnelSimpleIcon /> Filter…
          </DropdownMenuItem>
          {filtered && (
            <DropdownMenuItem onClick={run((p) => setColumnFilter(editor, p, col, null))}>
              <FunnelSimpleXIcon /> Clear filter
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!actions?.moveLeft} onClick={run((p) => moveColumn(editor, p, col, col - 1))}>
            <ArrowLeftIcon /> Move left
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!actions?.moveRight} onClick={run((p) => moveColumn(editor, p, col, col + 1))}>
            <ArrowRightIcon /> Move right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={!actions?.delete} onClick={run((p) => deleteColumn(editor, p, col))}>
            <TrashIcon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover open={menu === "filter"} onOpenChange={(open) => !open && closeIf("filter")}>
        {/* Invisible anchor so the popover hangs under the header button. */}
        <PopoverTrigger
          render={<button type="button" tabIndex={-1} aria-hidden className="pointer-events-none absolute opacity-0" style={place(placed)} />}
        />
        <FilterPopoverContent editor={editor} tablePos={tablePos} col={col} onDone={() => closeIf("filter")} />
      </Popover>
    </>
  );
}

/** The filter popover's panel. Focus is not returned to the (hidden) trigger; Enter and Clear focus the editor. */
export function FilterPopoverContent({ editor, tablePos, col, onDone }: { editor: Editor; tablePos: number; col: number; onDone: () => void }) {
  return (
    <PopoverContent side="bottom" align="end" sideOffset={6} finalFocus={false} className={cn(POPOVER_SURFACE, "w-60 p-2")} data-table-control>
      <FilterForm editor={editor} tablePos={tablePos} col={col} onDone={onDone} />
    </PopoverContent>
  );
}

/** Mounted only while the popover is open, so the field starts from the column's current filter. */
function FilterForm({ editor, tablePos, col, onDone }: { editor: Editor; tablePos: number; col: number; onDone: () => void }) {
  const [value, setValue] = useState(() => getColumnFilters(editor, tablePos)[col] ?? "");
  const { shown, total } = filterSummary(editor, tablePos);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onDone();
        editor.view.focus();
      }}
    >
      <Input
        autoFocus
        className={MENU_INPUT}
        aria-label="Filter column"
        placeholder="Contains…"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setColumnFilter(editor, tablePos, col, event.target.value);
        }}
      />
      <div className="flex items-center justify-between text-xs text-popover-foreground/70">
        <span data-testid="table-filter-count">
          {shown} of {total} rows
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-xs"
          disabled={value === ""}
          onClick={() => {
            setValue("");
            setColumnFilter(editor, tablePos, col, null);
            editor.view.focus();
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}
