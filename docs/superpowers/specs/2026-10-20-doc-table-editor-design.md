# Notion-like table editing in the /doc editor

Date: 2026-10-20. Autopilot run (`/auto`): the user asked for "a Notion-like table editor in the document editor"
and opted out of questions, so every call below is Claude's call.

## Intent

The /doc editor already renders GFM tables and inserts a 3×3 table from the slash menu. Editing that table is
hard: there is no way to add, remove, move or align rows and columns except by retyping markdown. Notion's simple
tables solve this with hover handles and menus. We copy that interaction.

## Constraint: the document is markdown

Documents persist as GFM markdown (localStorage + agent tools `doc_*`). Anything markdown cannot hold is lost on
the next save or agent write. So:

- **Persisted:** rows, columns, cell text with inline marks, column alignment (`:---`, `:---:`, `---:`).
- **Not built (non-goals):** column widths/resizing, merged cells, cell colours, header column, a toggle that
  removes the header row. GFM always has exactly one header row: the first row.

## Behaviour

- Hover a table → a grip appears on the left border of the hovered row and on the top border of the hovered column.
  Clicking a grip selects that whole row/column (cell selection) and opens its menu.
- Row menu: Insert above, Insert below, Move up, Move down, Duplicate, Clear contents, Delete.
  The header row cannot move, be duplicated, get a row inserted above it, or be deleted (those items are disabled).
  A body row cannot move into the header position.
- Column menu: Align left / center / right (current one checked; clicking it again resets to the default `---`), Insert left, Insert right, Move left,
  Move right, Duplicate, Clear contents, Delete (disabled for the last remaining column).
- Hover a table → a thin "+" bar under the table adds a row; a thin "+" bar on its right adds a column.
- Drag across cells selects a range (prosemirror-tables), the selection is highlighted, Backspace/Delete clears it.
  Tab / Shift-Tab move between cells; Tab in the last cell adds a row (built in).
- Columns keep a minimum width; a wide table scrolls horizontally inside the document column.
- Every action is one undoable transaction.

## Agent

`doc_create` / `doc_edit` descriptions mention column alignment syntax, so the agent can write aligned tables.
No tool schema or name changes.
