import { useEffect, useRef, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { FunnelSimpleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Transaction } from "@tiptap/pm/state";
import { FILTER_ICON_NO_BG, FilterPopoverContent } from "./ColumnHeaderMenu";
import { tableFilterKey } from "./tableFilter";
import { headButton, place, relativeTo, visibleSpan, type Placed } from "./tableGeometry";

interface Indicator {
  /** Stable across edits: (index of the table among the document's tables):(column). Never the position. */
  key: string;
  tablePos: number;
  col: number;
  placed: Placed;
}

const box = (rect: DOMRect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });

function tableElement(editor: Editor, pos: number): HTMLTableElement | null {
  try {
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLTableElement) return dom;
    return dom instanceof Element ? dom.querySelector("table") : null;
  } catch {
    // the DOM and the document are momentarily out of step; the next transaction re-measures
    return null;
  }
}

function tableIndex(editor: Editor, pos: number): number {
  let index = 0;
  editor.state.doc.descendants((node, at) => {
    if (node.type.name === "table" && at < pos) index++;
    return false;
  });
  return index;
}

function measureAll(editor: Editor, container: HTMLElement): Indicator[] {
  const origin = box(container.getBoundingClientRect());
  const found: Indicator[] = [];
  for (const entry of tableFilterKey.getState(editor.state)?.tables ?? []) {
    const table = tableElement(editor, entry.pos);
    if (!table) continue;
    const tableBox = relativeTo(box(table.getBoundingClientRect()), origin);
    const wrapperBox = relativeTo(box((table.parentElement ?? table).getBoundingClientRect()), origin);
    const visible = visibleSpan(tableBox, wrapperBox);
    for (const col of Object.keys(entry.filters).map(Number)) {
      const cell = table.rows[0]?.cells[col];
      const key = `${tableIndex(editor, entry.pos)}:${col}`;
      const placed = cell ? headButton(relativeTo(box(cell.getBoundingClientRect()), origin), visible) : null;
      if (placed) found.push({ key, tablePos: entry.pos, col, placed });
    }
  }
  return found;
}

/** Whether a step of `tr` starts before `end` (document positions, new document). */
function changesBefore(tr: Transaction, end: number): boolean {
  let hit = false;
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_a, _b, start) => {
      if (rest.map(start, -1) < end) hit = true;
    });
  });
  return hit;
}

const sameIndicators = (a: Indicator[], b: Indicator[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A funnel in the header of every filtered column, shown whether or not the pointer is over the table (the
 * filter is invisible in the markdown, so this is its only reminder). It re-measures on filter changes, edits,
 * scroll and resize, and never takes focus: clicking it opens that column's filter popover.
 */
export function ColumnFilterIndicators({ editor, containerRef }: { editor: Editor; containerRef: RefObject<HTMLElement | null> }) {
  const [items, setItems] = useState<Indicator[]>([]);
  /** The indicator whose popover is open stays mounted even when its filter is cleared meanwhile (empty input). */
  const [pinned, setPinned] = useState<Indicator | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let filters = tableFilterKey.getState(editor.state)?.tables;
    const update = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const next = measureAll(editor, container);
        setItems((prev) => (sameIndicators(prev, next) ? prev : next));
      });
    };
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      const next = tableFilterKey.getState(editor.state)?.tables;
      const same = next === filters;
      // Nothing filtered before or after: nothing to draw, and typing must not cost a measure.
      const idle = !filters?.length && !next?.length;
      filters = next;
      if (idle || (same && !transaction.docChanged)) return;
      // Same entries (no position moved) and every change lies after the last filtered table: layout is untouched.
      const end = Math.max(0, ...(next ?? []).map((t) => t.pos + (editor.state.doc.nodeAt(t.pos)?.nodeSize ?? 0)));
      if (same && !changesBefore(transaction, end)) return;
      update();
    };
    editor.on("transaction", onTransaction);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    update();
    return () => {
      cancelAnimationFrame(frame.current);
      editor.off("transaction", onTransaction);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editor, containerRef]);

  const shown = pinned && !items.some((i) => i.key === pinned.key) ? [...items, pinned] : items;
  if (shown.length === 0) return null;
  return (
    <div data-testid="table-filter-indicators" data-table-control className="hidden sm:block">
      {shown.map((item) => (
        <IndicatorButton
          key={item.key}
          editor={editor}
          item={item}
          open={pinned?.key === item.key}
          onOpenChange={(open) => setPinned(open ? item : null)}
        />
      ))}
    </div>
  );
}

function IndicatorButton({
  editor,
  item,
  open,
  onOpenChange,
}: {
  editor: Editor;
  item: Indicator;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Filtered column, edit filter"
            data-table-control
            className={cn("absolute z-[9] h-auto min-w-0 rounded-sm p-0 text-foreground [&_svg:not([class*='size-'])]:size-3.5", FILTER_ICON_NO_BG)}
            style={place(item.placed)}
            // Keep the editor's focus and selection until the popover input takes over.
            onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
          >
            <FunnelSimpleIcon />
          </Button>
        }
      />
      <FilterPopoverContent editor={editor} tablePos={item.tablePos} col={item.col} onDone={() => onOpenChange(false)} />
    </Popover>
  );
}
