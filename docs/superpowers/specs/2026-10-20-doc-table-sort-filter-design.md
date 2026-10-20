# Sort and filter in /doc table column headers

Date: 2026-10-20. Autopilot run (`/auto`): the user asked for "a sort and filter setting in the header of every
table column, like this Pinterest reference" (a data-grid header with a menu button: Sort ascending, Sort
descending, Filter, Move left, Move right, Delete). Every call below is Claude's call.

Builds on `2026-10-20-doc-table-editor-design.md` (row/column grips, "+" bars).

## Constraint: the document is markdown

A sort can be stored: it is a new row order. A filter cannot: GFM has nowhere to keep it. So:

- **Sort is a one-time edit.** Sorting reorders the body rows in the document (one undoable transaction).
  The header row never moves. There is no "sorted by" state to keep in sync after later edits.
- **Filter is view-only.** It hides body rows on screen through ProseMirror decorations. The markdown, the
  autosave and the agent's `doc_read` keep every row. A filter lives only in the open editor (lost on reload or
  on switching documents).

## Behaviour

- Hovering a table shows a small menu button at the right edge of the hovered column's header cell. A column
  with an active filter shows its button all the time, highlighted (it is the filter indicator).
- Header menu: Sort ascending, Sort descending, Filter…, (Clear filter, when one is set), Move left,
  Move right, Delete. Move/Delete reuse the existing column commands and their disabled rules.
- Sort order: compare the cells' plain text. The mode is chosen once per column: by number only when every non-empty cell is a number, otherwise
  `localeCompare` with `{ numeric: true, sensitivity: "base" }` for all cells. A number may have spaces
  (including no-break and narrow), thousands commas (`1,200`), one leading currency symbol ($ € £ ₽ ¥) and a
  trailing `%`; `-10` is a number. Empty cells go last in both directions. Stable for equal keys.
- Filter: "contains" text, case-insensitive, on the cell's plain text, with the query trimmed (a blank query clears the filter). The Filter item opens a small popover
  under the header with a text input (live filtering as you type), the number of shown rows, and Clear.
  Several columns can be filtered at once (AND).
- A body row whose cells are all empty is never hidden, so a row added with "+" or Tab stays visible for
  typing. A body row also stays visible while the user edits it: the
  protected row is the row of the selection at the last document change made inside the table body. The
  protection ends when the selection leaves that row or when any filter changes, so opening Filter… with the
  caret in a non-matching row does not keep that row visible. The "N of M rows" count uses the same hidden set
  as the screen.
- A filtered column shows a small funnel in its header all the time, also when the pointer is elsewhere; it opens
  that column's filter popover and never takes focus by itself.
- Filters follow their table through edits (positions are mapped). Moving a column through the menus moves its
  filter with it; deleting a column drops its filter; a table that stops being a table (deleted, or replaced by something else) drops all filters. A change made without
  saying how (undo, paste, the agent) keeps all of a table's filters only when its header texts are identical
  or exactly one header differs with the same column count (a header being edited); anything else (several
  headers, a reorder, another count) drops all of that table's filters, so an undone column move drops them.
  Only the table's own structural commands (sort, row and column commands) and a wrap or lift in a quote, list
  or toggle keep a filter across a replace; `setContent`, a paste over the table or a deletion never do.
  Sorting leaves the cursor in the sorted column's header cell.

## Agent

No change: filters are invisible to the markdown, sort is an ordinary edit.
