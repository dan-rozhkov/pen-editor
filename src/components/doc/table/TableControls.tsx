import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CopyIcon,
  DotsSixIcon,
  DotsSixVerticalIcon,
  EraserIcon,
  PlusIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  addColumnBar,
  addRowBar,
  columnGrip,
  headButton,
  hoveredCell,
  isTableControl,
  place,
  relativeTo,
  rowGrip,
  visibleSpan,
  type HoveredCell,
  type Placed,
} from "./tableGeometry";
import { skipBaseUiOpen } from "../ui/baseUi";
import { ColumnHeaderMenu, type HeaderMenuKind } from "./ColumnHeaderMenu";
import { ColumnFilterIndicators } from "./ColumnFilterIndicators";
import { FILTERED_ROW_CLASS, tableFilterKey } from "./tableFilter";
import {
  appendColumn,
  appendRow,
  clearColumn,
  clearRow,
  columnActions,
  deleteColumn,
  deleteRow,
  duplicateColumn,
  duplicateRow,
  getColumnAlign,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  rowActions,
  selectColumn,
  selectRow,
  setColumnAlign,
  tableAround,
  type ColumnAlign,
} from "./tableCommands";

interface Props {
  editor: Editor;
  /** The `relative` element that wraps the editor; the controls are positioned inside it. */
  containerRef: RefObject<HTMLElement | null>;
}

interface Layout {
  rowGrip: Placed;
  columnGrip: Placed | null;
  headButton: Placed | null;
  rowBar: Placed;
  columnBar: Placed;
}

type MenuKind = "row" | "col" | HeaderMenuKind;

/** The document position directly before the table, re-resolved from its DOM on every use (null once detached). */
function resolveTablePos(editor: Editor, table: HTMLTableElement): number | null {
  const cell = table.rows[0]?.cells[0];
  if (!cell || !table.isConnected) return null;
  try {
    return tableAround(editor, editor.view.posAtDOM(cell, 0));
  } catch {
    // the DOM and the document are momentarily out of step; the next transaction re-measures
    return null;
  }
}

function box(rect: DOMRect) {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/** Positions of everything for the hovered cell, in container coordinates. Null when the cell is gone. */
function measure(hit: HoveredCell, container: HTMLElement): Layout | null {
  const { table, row, col } = hit;
  const rowEl = table.rows[row];
  const headCell = table.rows[0]?.cells[col];
  if (!table.isConnected || !rowEl || !headCell) return null;
  const origin = box(container.getBoundingClientRect());
  const tableBox = relativeTo(box(table.getBoundingClientRect()), origin);
  const wrapper = table.parentElement ?? table;
  const wrapperBox = relativeTo(box(wrapper.getBoundingClientRect()), origin);
  const visible = visibleSpan(tableBox, wrapperBox);
  return {
    rowGrip: rowGrip(relativeTo(box(rowEl.getBoundingClientRect()), origin), visible),
    columnGrip: columnGrip(relativeTo(box(headCell.getBoundingClientRect()), origin), tableBox.top, visible),
    headButton: headButton(relativeTo(box(headCell.getBoundingClientRect()), origin), visible),
    rowBar: addRowBar(tableBox, visible),
    columnBar: addColumnBar(tableBox, visible, Math.min(container.clientWidth, wrapperBox.right)),
  };
}

const sameHit = (a: HoveredCell | null, b: HoveredCell | null) =>
  a === b || (!!a && !!b && a.table === b.table && a.row === b.row && a.col === b.col);

const samePlaced = (a: Placed | null, b: Placed | null) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

const sameLayout = (a: Layout | null, b: Layout | null) =>
  a === b ||
  (!!a &&
    !!b &&
    samePlaced(a.rowGrip, b.rowGrip) &&
    samePlaced(a.columnGrip, b.columnGrip) &&
    samePlaced(a.headButton, b.headButton) &&
    samePlaced(a.rowBar, b.rowBar) &&
    samePlaced(a.columnBar, b.columnBar));

const GRIP_CLASS =
  "absolute z-10 h-auto min-w-0 rounded-sm border border-border bg-surface-panel p-0 text-text-muted shadow-xs hover:bg-secondary hover:text-foreground [&_svg:not([class*='size-'])]:size-3";
const BAR_CLASS =
  "absolute z-10 flex h-auto min-w-0 items-center justify-center rounded-md bg-foreground/5 p-0 text-text-muted hover:bg-foreground/10 hover:text-foreground focus-visible:bg-foreground/10 [&_svg:not([class*='size-'])]:size-3.5";

/** The round grip button that opens a row/column menu; keeps the editor selection when pressed. */
function GripTrigger({
  label,
  style,
  onClick,
  children,
}: {
  label: string;
  style: CSSProperties;
  onClick: (event: unknown) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          aria-label={label}
          data-table-control
          className={GRIP_CLASS}
          style={style}
          onPointerDown={skipBaseUiOpen}
          onMouseDown={(event: unknown) => {
            skipBaseUiOpen(event);
            (event as React.MouseEvent).preventDefault();
          }}
          onClick={onClick}
        >
          {children}
        </Button>
      }
    />
  );
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

const ALIGNS: { align: ColumnAlign; label: string; icon: React.ReactNode }[] = [
  { align: "left", label: "Align left", icon: <TextAlignLeftIcon /> },
  { align: "center", label: "Align center", icon: <TextAlignCenterIcon /> },
  { align: "right", label: "Align right", icon: <TextAlignRightIcon /> },
];

/** Notion's table handles: row/column grips with menus, and "+" bars that append a row or column. */
export function TableControls(props: Props) {
  return (
    <>
      <ColumnFilterIndicators editor={props.editor} containerRef={props.containerRef} />
      <HoverControls {...props} />
    </>
  );
}

function HoverControls({ editor, containerRef }: Props) {
  const [hit, setHit] = useState<HoveredCell | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [menu, setMenu] = useState<MenuKind | null>(null);
  const hitRef = useRef<HoveredCell | null>(null);
  const menuRef = useRef<MenuKind | null>(null);
  /** Re-checks whether the pointer is still over the table or its controls; set by the listener effect. */
  const recheckRef = useRef<() => void>(() => {});
  /** Filters live in the editor state, not here: bump a render when they change so the header button follows. */
  const [, bump] = useReducer((n: number) => n + 1, 0);
  /** The one way to change the menu: the ref is written together with the state, so handlers never read a stale one. */
  const setMenuBoth = useCallback((next: MenuKind | null) => {
    menuRef.current = next;
    setMenu(next);
    // While a menu was open the hover was frozen: the pointer may have left meanwhile.
    if (next === null) recheckRef.current();
  }, []);

  const show = useCallback(
    (next: HoveredCell | null) => {
      const container = containerRef.current;
      const nextLayout = next && container ? measure(next, container) : null;
      const value = nextLayout ? next : null;
      // A menu cannot outlive what it hangs off.
      const anchored = menuRef.current === "col" ? nextLayout?.columnGrip : nextLayout?.headButton;
      const needsAnchor = menuRef.current === "col" || menuRef.current === "head" || menuRef.current === "filter";
      if (menuRef.current && (!value || (needsAnchor && !anchored))) {
        menuRef.current = null;
        setMenu(null);
      }
      if (!sameHit(hitRef.current, value)) {
        hitRef.current = value;
        setHit(value);
      }
      setLayout((prev) => (sameLayout(prev, nextLayout) ? prev : nextLayout));
    },
    [containerRef],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    /** Set by a keypress: the controls stay hidden while typing until the pointer really moves. */
    let typing = false;
    let lastX = NaN;
    let lastY = NaN;
    /** Last pointer position anywhere on the page (the menu popup lives outside the container). */
    let pointerX = NaN;
    let pointerY = NaN;
    const trackPointer = (event: MouseEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
    };
    const schedule = (run: () => void) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    };
    const onMove = (event: MouseEvent) => {
      // Layout shifts under a still pointer make the browser emit mousemoves with the same coordinates.
      if (typing && event.clientX === lastX && event.clientY === lastY) return;
      typing = false;
      lastX = event.clientX;
      lastY = event.clientY;
      if (menuRef.current) return;
      const target = event.target;
      if (isTableControl(target)) {
        // Crossing the gap onto a bar may have scheduled a hide; the pointer is on a control now.
        cancelAnimationFrame(frame);
        return;
      }
      schedule(() => {
        // Only cells of tables in this editor count; nested editors and widgets do not.
        const cell = editor.view.dom.contains(target as Node) ? hoveredCell(target) : null;
        const current = hitRef.current;
        // The wrapper's padding (the gap before the bars) still belongs to the hovered table.
        if (!cell && current && target instanceof Node && current.table.parentElement?.contains(target)) return;
        if (sameHit(cell, current)) return; // same cell: nothing moved, skip the measure
        show(cell);
      });
    };
    recheckRef.current = () => {
      cancelAnimationFrame(frame);
      const el = document.elementFromPoint(pointerX, pointerY);
      if (isTableControl(el)) return;
      const current = hitRef.current;
      if (current && el && current.table.parentElement?.contains(el)) return;
      show(null);
    };
    const onLeave = () => {
      if (menuRef.current) return;
      cancelAnimationFrame(frame);
      show(null);
    };
    const remeasure = () => {
      if (!hitRef.current || typing) return;
      const current = hitRef.current;
      schedule(() => {
        const rows = current.table.rows;
        const clamped = { ...current, row: Math.min(current.row, rows.length - 1) };
        clamped.col = Math.min(clamped.col, (rows[0]?.cells.length ?? 1) - 1);
        // A row the filter just hid is no hover target; an open menu falls back to the (never hidden) header.
        if (rows[clamped.row]?.classList.contains(FILTERED_ROW_CLASS)) clamped.row = menuRef.current ? 0 : -1;
        show(rows.length && clamped.row >= 0 ? clamped : null);
      });
    };
    let filterTables = tableFilterKey.getState(editor.state)?.tables;
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      // The array only changes with the filters themselves, not with every edit or selection move.
      const nextTables = tableFilterKey.getState(editor.state)?.tables;
      const filtersChanged = nextTables !== filterTables;
      if (filtersChanged) {
        filterTables = nextTables;
        bump();
      }
      if (!transaction.docChanged && !filtersChanged) return;
      if (!transaction.docChanged) {
        remeasure();
        return;
      }
      // The open menu targets a row/column by index; after any document change that may be another one.
      if (menuRef.current) setMenuBoth(null);
      if (!hitRef.current) return;
      remeasure();
    };
    const hide = (event: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(event.key)) return;
      typing = true;
      // ProseMirror's keydown ran first and may have scheduled a remeasure that would re-show the controls.
      cancelAnimationFrame(frame);
      if (!menuRef.current) show(null);
    };
    const dom = editor.view.dom;
    document.addEventListener("mousemove", trackPointer, true);
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    // Scroll events do not bubble: capture on window catches the table's scroll wrapper and any scrolling ancestor.
    window.addEventListener("scroll", remeasure, true);
    window.addEventListener("resize", remeasure);
    dom.addEventListener("keydown", hide);
    editor.on("transaction", onTransaction);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousemove", trackPointer, true);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("scroll", remeasure, true);
      window.removeEventListener("resize", remeasure);
      dom.removeEventListener("keydown", hide);
      editor.off("transaction", onTransaction);
    };
  }, [editor, containerRef, show, setMenuBoth]);

  const ready = editor.isEditable && !!hit && !!layout;
  const tablePos = ready ? resolveTablePos(editor, hit.table) : null;
  // A menu cannot outlive what it hangs off: without this, a stale `menu` blocks every later hover.
  const menuAnchored =
    menu === null ||
    (tablePos !== null && (menu === "row" || (menu === "col" ? !!layout?.columnGrip : !!layout?.headButton)));
  const activeMenu = menuAnchored ? menu : null;

  if (!ready || tablePos === null) return null;
  const { row, col } = hit;
  // Each action resolves the table's CURRENT position when it runs, never a cached number.
  const run = (action: (pos: number) => unknown) => () => {
    const pos = resolveTablePos(editor, hit.table);
    if (pos !== null) action(pos);
    setMenuBoth(null);
  };
  // Menu state is read only while a menu is open.
  const rows = activeMenu === "row" ? rowActions(editor, tablePos, row) : null;
  const cols = activeMenu === "col" ? columnActions(editor, tablePos, col) : null;
  const headActions = activeMenu === "head" ? columnActions(editor, tablePos, col) : null;
  const currentAlign = activeMenu === "col" ? getColumnAlign(editor, tablePos, col) : null;

  const openMenu = (kind: MenuKind) => (event: unknown) => {
    skipBaseUiOpen(event);
    if (activeMenu === kind) return setMenuBoth(null);
    const pos = resolveTablePos(editor, hit.table);
    if (pos === null) return;
    if (kind === "row") selectRow(editor, pos, row);
    else selectColumn(editor, pos, col);
    setMenuBoth(kind);
  };
  const closeIf = (kind: HeaderMenuKind) => {
    if (menuRef.current === kind) setMenuBoth(null);
  };
  // Keep the editor selection (and its CellSelection) when pressing a control.
  const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div data-testid="table-controls" data-table-control className="hidden sm:block">
      <DropdownMenu open={activeMenu === "row"} onOpenChange={(open) => !open && setMenuBoth(null)} modal={false}>
        <GripTrigger label="Row options" style={place(layout.rowGrip)} onClick={openMenu("row")}>
          <DotsSixVerticalIcon />
        </GripTrigger>
        <DropdownMenuContent align="start" side="right" finalFocus={false} className="w-auto min-w-44" data-table-control>
          <DropdownMenuItem disabled={!rows?.insertBefore} onClick={run((p) => insertRow(editor, p, row, "before"))}>
            <ArrowUpIcon /> Insert above
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!rows?.insertAfter} onClick={run((p) => insertRow(editor, p, row, "after"))}>
            <ArrowDownIcon /> Insert below
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!rows?.moveUp} onClick={run((p) => moveRow(editor, p, row, row - 1))}>
            <ArrowUpIcon /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!rows?.moveDown} onClick={run((p) => moveRow(editor, p, row, row + 1))}>
            <ArrowDownIcon /> Move down
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!rows?.duplicate} onClick={run((p) => duplicateRow(editor, p, row))}>
            <CopyIcon /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!rows?.clear} onClick={run((p) => clearRow(editor, p, row))}>
            <EraserIcon /> Clear contents
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={!rows?.delete} onClick={run((p) => deleteRow(editor, p, row))}>
            <TrashIcon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {layout.columnGrip && (
        <DropdownMenu open={activeMenu === "col"} onOpenChange={(open) => !open && setMenuBoth(null)} modal={false}>
          <GripTrigger label="Column options" style={place(layout.columnGrip)} onClick={openMenu("col")}>
            <DotsSixIcon />
          </GripTrigger>
          <DropdownMenuContent align="start" side="bottom" finalFocus={false} className="w-auto min-w-44" data-table-control>
            {ALIGNS.map(({ align, label, icon }) => (
              <DropdownMenuCheckboxItem
                key={align}
                checked={currentAlign === align}
                disabled={!cols?.align}
                onCheckedChange={(checked) => run((p) => setColumnAlign(editor, p, col, checked ? align : null))()}
              >
                {icon} {label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!cols?.insertBefore} onClick={run((p) => insertColumn(editor, p, col, "before"))}>
              <ArrowLeftIcon /> Insert left
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!cols?.insertAfter} onClick={run((p) => insertColumn(editor, p, col, "after"))}>
              <ArrowRightIcon /> Insert right
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!cols?.moveLeft} onClick={run((p) => moveColumn(editor, p, col, col - 1))}>
              <ArrowLeftIcon /> Move left
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!cols?.moveRight} onClick={run((p) => moveColumn(editor, p, col, col + 1))}>
              <ArrowRightIcon /> Move right
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!cols?.duplicate} onClick={run((p) => duplicateColumn(editor, p, col))}>
              <CopyIcon /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!cols?.clear} onClick={run((p) => clearColumn(editor, p, col))}>
              <EraserIcon /> Clear contents
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={!cols?.delete} onClick={run((p) => deleteColumn(editor, p, col))}>
              <TrashIcon /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {layout.headButton && (
        <ColumnHeaderMenu
          editor={editor}
          tablePos={tablePos}
          col={col}
          placed={layout.headButton}
          menu={activeMenu}
          actions={headActions}
          setMenu={setMenuBoth}
          closeIf={closeIf}
          run={run}
        />
      )}

      <Button
        variant="ghost"
        aria-label="Add row"
        data-table-control
        className={BAR_CLASS}
        style={place(layout.rowBar)}
        onMouseDown={keepFocus}
        onClick={run((p) => appendRow(editor, p))}
      >
        <PlusIcon />
      </Button>
      <Button
        variant="ghost"
        aria-label="Add column"
        data-table-control
        className={BAR_CLASS}
        style={place(layout.columnBar)}
        onMouseDown={keepFocus}
        onClick={run((p) => appendColumn(editor, p))}
      >
        <PlusIcon />
      </Button>
    </div>
  );
}
