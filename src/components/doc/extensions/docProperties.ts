import { Extension, Node, type Editor, type MarkdownToken, mergeAttributes, type JSONContent } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { Plugin, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { isSlashActive } from "../slash/slashKey";
import { PropertyListView, PropertyRowView } from "./PropertyViews";

// Notion's page properties, stored as a GFM table with TWO columns whose header cells are both empty:
//
//   |  |  |
//   | --- | --- |
//   | Status | <span data-bg="gray">Active</span> |
//   | Owner |  |
//
// Any other table (a non-empty header, another column count) stays a normal Table. The header line must be
// our own (each cell at most two whitespace characters): the stock serializer pads the empty header of a
// header-less table (pasted HTML without <th>, cleared header cells) to `|      |     |`, and that must stay a Table. The row icon is
// inferred from the value at render time and never stored.

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docProperties: {
      /** Insert a property list with one empty row and put the cursor in its key. */
      insertPropertyList: () => ReturnType;
    };
  }
}

// ---- icon inference (pure) ----

export type PropertyIconKind = "text" | "date" | "link" | "tags" | "number" | "lines";

export interface PropertyValueFacts {
  text: string;
  hasLink: boolean;
  /** Non-empty and every text run carries a background highlight (a tag chip). */
  onlyTags: boolean;
}

// Whole-word English month names (full or abbreviated, optional dot) and Russian genitive names.
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const MONTH_RU = "(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)";

/** Day and month in either order, year with four digits: `20.10.2026`, `10/20/2026`; not versions like `2.10.15`. */
function isNumericDate(text: string): boolean {
  const m = /^(\d{1,2})[./](\d{1,2})[./]\d{4}$/.exec(text);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (a >= 1 && a <= 31 && b >= 1 && b <= 12) || (a >= 1 && a <= 12 && b >= 1 && b <= 31);
}

const DATE_FORMS = [
  /^\d{4}-(?:0?[1-9]|1[0-2])-(?:0?[1-9]|[12]\d|3[01])(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/,
  new RegExp(`^${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}$`, "i"),
  new RegExp(`^\\d{1,2}\\s+${MONTH},?\\s+\\d{4}$`, "i"),
  new RegExp(`^\\d{1,2}\\s+${MONTH_RU},?\\s+\\d{4}(?:\\s*г\\.?)?$`, "i"),
];

/** A date, or two dates joined by an arrow. */
export function isDateText(text: string): boolean {
  const parts = text.trim().split(/\s*→\s*/);
  return parts.length <= 2 && parts.every((part) => isNumericDate(part.trim()) || DATE_FORMS.some((form) => form.test(part.trim())));
}

export function inferIconKind(facts: PropertyValueFacts): PropertyIconKind {
  const text = facts.text.trim();
  if (!text) return "text";
  if (isDateText(text)) return "date";
  if (facts.hasLink) return "link";
  if (facts.onlyTags) return "tags";
  if (/^[-+]?\d+(?:[.,]\d+)?$/.test(text)) return "number";
  return "lines";
}

export function valueFacts(value: PMNode | null | undefined): PropertyValueFacts {
  let hasLink = false;
  let runs = 0;
  let tagged = 0;
  value?.descendants((node) => {
    if (!node.isText || !node.text?.trim()) return;
    runs += 1;
    if (node.marks.some((mark) => mark.type.name === "link")) hasLink = true;
    if (node.marks.some((mark) => mark.type.name === "docColor" && mark.attrs.background)) tagged += 1;
  });
  return { text: value?.textContent ?? "", hasLink, onlyTags: runs > 0 && runs === tagged };
}

// ---- schema ----

/**
 * Start of the list that `replaceSelectionWith` just inserted: the end of the last step's replaced range
 * (mapped through that step only) minus the list's size. Independent of where the selection lands, which is
 * unreliable when blocks follow the insertion point.
 */
function newListStart(tr: Transaction, list: PMNode): number {
  const map = tr.mapping.maps[tr.mapping.maps.length - 1];
  let end = -1;
  map?.forEach((_oldStart, _oldEnd, _newStart, newEnd) => {
    end = newEnd;
  });
  const start = end - list.nodeSize;
  return end !== -1 && tr.doc.nodeAt(start)?.type === list.type ? start : -1;
}

const KEY = "propertyKey";
const VALUE = "propertyValue";
const ROW = "propertyRow";
const LIST = "propertyList";

export const PropertyList = Node.create({
  name: LIST,
  group: "block",
  content: `${ROW}+`,
  defining: true,
  parseHTML: () => [{ tag: 'div[data-type="property-list"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "property-list" }), 0],
  addNodeView: () => ReactNodeViewRenderer(PropertyListView),
  addCommands() {
    return {
      insertPropertyList:
        () =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes[LIST];
          const list = type.createAndFill();
          if (!list) return false;
          if (dispatch) {
            tr.replaceSelectionWith(list);
            const start = newListStart(tr, list);
            if (start !== -1) tr.setSelection(TextSelection.create(tr.doc, start + 3));
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },
  renderMarkdown(node, h) {
    const cell = (cellNode: JSONContent | undefined): string => {
      const raw = cellNode?.content ? h.renderChildren(cellNode.content) : "";
      return raw
        .replace(/[ \t]*\r?\n[ \t]*/g, "<br>")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\\.|\|/g, (m) => (m === "|" ? "\\|" : m));
    };
    const rows = (node.content ?? []).map((row) => `| ${cell(row.content?.[0])} | ${cell(row.content?.[1])} |`);
    return ["|  |  |", "| --- | --- |", ...rows].join("\n");
  },
});

export const PropertyRow = Node.create({
  name: ROW,
  content: `${KEY} ${VALUE}`,
  defining: true,
  parseHTML: () => [{ tag: 'div[data-type="property-row"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "property-row" }), 0],
  addNodeView: () => ReactNodeViewRenderer(PropertyRowView),
});

export const PropertyKey = Node.create({
  name: KEY,
  content: "inline*",
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-type="property-key"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "property-key" }), 0],
});

export const PropertyValue = Node.create({
  name: VALUE,
  content: "inline*",
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-type="property-value"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "property-value" }), 0],
});

// ---- markdown intake: the stock Table owns the `table` token, so it is the one to decide ----

const baseTableParse = Table.config.parseMarkdown;

interface CellToken {
  text?: string;
  tokens?: unknown[];
}

/** Our own header line: two cells of at most two whitespace characters (`| |` or `|  |`), unlike the stock padding. */
const OWN_HEADER = /^\|[ \t]{0,2}\|[ \t]{0,2}\|[ \t]*$/;

/** A two-column table with our empty header line and at least one body row. */
function isPropertyTable(token: MarkdownToken): boolean {
  const header = token.header as CellToken[] | undefined;
  const firstLine = (token.raw ?? "").trimStart().split(/\r?\n/, 1)[0];
  return (
    header?.length === 2 &&
    header.every((cell) => !(cell.text ?? "").trim()) &&
    OWN_HEADER.test(firstLine) &&
    ((token.rows as unknown[] | undefined)?.length ?? 0) > 0
  );
}

export const DocTable = Table.extend({
  parseMarkdown(token, h) {
    if (!isPropertyTable(token)) return baseTableParse!.call(this, token, h);
    const rows = (token.rows as CellToken[][]).map((row) =>
      h.createNode(ROW, undefined, [
        h.createNode(KEY, undefined, h.parseInline((row[0]?.tokens ?? []) as never)),
        h.createNode(VALUE, undefined, h.parseInline((row[1]?.tokens ?? []) as never)),
      ]),
    );
    return h.createNode(LIST, undefined, rows);
  },
});

// ---- editing ----

interface Where {
  part: "key" | "value";
  rowDepth: number;
  listDepth: number;
}

function locate($pos: ResolvedPos): Where | null {
  for (let depth = $pos.depth; depth > 2; depth -= 1) {
    const name = $pos.node(depth).type.name;
    if (name !== KEY && name !== VALUE) continue;
    if ($pos.node(depth - 1).type.name !== ROW || $pos.node(depth - 2).type.name !== LIST) return null;
    return { part: name === KEY ? "key" : "value", rowDepth: depth - 1, listDepth: depth - 2 };
  }
  return null;
}

/** True when `$pos` is inside a property key or value (any depth). */
export function isInPropertyCell($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name;
    if (name === KEY || name === VALUE) return true;
  }
  return false;
}

function cursorIn(tr: Transaction, pos: number, bias: 1 | -1): Transaction {
  return tr.setSelection(TextSelection.near(tr.doc.resolve(pos), bias));
}

/** Start of a row's key content. */
const keyStart = (rowPos: number) => rowPos + 2;

function appendRow(state: EditorState, tr: Transaction, at: number): Transaction {
  const row = state.schema.nodes[ROW].createAndFill()!;
  tr.insert(at, row);
  return cursorIn(tr, keyStart(at), 1);
}

/**
 * The transaction to build on. With `replaceSelection` (Enter only) a non-empty selection is deleted inside its
 * cell first; otherwise it is left alone and the caller just moves the caret.
 * Null (default behaviour) when not in a cell, while the slash menu is open, or when the selection leaves the cell.
 */
function begin(state: EditorState, replaceSelection = false): { tr: Transaction; $from: ResolvedPos; where: Where } | null {
  if (isSlashActive(state)) return null;
  const { $from, $to, empty } = state.selection;
  if (!locate($from)) return null;
  const tr = state.tr;
  if (!empty) {
    if (!$from.sameParent($to)) return null;
    if (replaceSelection) tr.deleteSelection();
  }
  const $now = tr.selection.$from;
  const where = locate($now);
  return where ? { tr, $from: $now, where } : null;
}

function onEnter(state: EditorState, dispatch: (tr: Transaction) => void): boolean {
  const ctx = begin(state, true);
  if (!ctx) return false;
  const { tr, $from, where } = ctx;
  const rowEnd = $from.after(where.rowDepth);
  if (where.part === "value") {
    dispatch(appendRow(state, tr, rowEnd).scrollIntoView());
    return true;
  }
  // key -> end of the value, which is the last content position of the row.
  dispatch(cursorIn(tr, rowEnd - 2, -1).scrollIntoView());
  return true;
}

function onTab(state: EditorState, dispatch: (tr: Transaction) => void, back: boolean): boolean {
  const ctx = begin(state);
  if (!ctx) return false;
  const { tr, $from, where } = ctx;
  const rowPos = $from.before(where.rowDepth);
  const rowEnd = $from.after(where.rowDepth);
  const list = $from.node(where.listDepth);
  const index = $from.index(where.listDepth);
  if (!back) {
    if (where.part === "key") return dispatch(cursorIn(tr, rowEnd - 2, -1)), true;
    // Last row's value: Tab appends a row like Enter does.
    if (index >= list.childCount - 1) return dispatch(appendRow(state, tr, rowEnd).scrollIntoView()), true;
    return dispatch(cursorIn(tr, keyStart(rowEnd), 1)), true;
  }
  if (where.part === "value") return dispatch(cursorIn(tr, keyStart(rowPos) + $from.node(where.rowDepth).firstChild!.content.size, -1)), true;
  // First row's key: swallowed so focus never leaves the list.
  if (index === 0) return true;
  return dispatch(cursorIn(tr, rowPos - 2, -1)), true;
}

function onBackspace(state: EditorState, dispatch: (tr: Transaction) => void): boolean {
  const { $from, empty } = state.selection;
  const where = locate($from);
  if (!where || !empty || $from.parentOffset !== 0) return false;
  const row = $from.node(where.rowDepth);
  const rowPos = $from.before(where.rowDepth);
  if (where.part === "value") {
    // The start of a value steps back into its key; the default join would merge two cells.
    dispatch(cursorIn(state.tr, keyStart(rowPos) + row.firstChild!.content.size, -1).scrollIntoView());
    return true;
  }
  // content.size, not textContent: an inline atom or hard break is content too.
  if (row.firstChild!.content.size > 0 || row.lastChild!.content.size > 0) return true; // swallowed: default clearNodes must never run on a key
  const list = $from.node(where.listDepth);
  const tr = state.tr;
  if (list.childCount > 1) {
    tr.delete(rowPos, rowPos + row.nodeSize);
    const index = $from.index(where.listDepth);
    if (index > 0) cursorIn(tr, rowPos - 2, -1);
    else cursorIn(tr, keyStart(rowPos), 1);
  } else {
    const listPos = $from.before(where.listDepth);
    tr.replaceWith(listPos, listPos + list.nodeSize, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, listPos + 1));
  }
  dispatch(tr.scrollIntoView());
  return true;
}

/** Append an empty row to the list that starts at `listPos` and focus its key (the "Add a property" line). */
export function addPropertyRow(editor: Editor, listPos: number): void {
  const { state, view } = editor;
  const list = state.doc.nodeAt(listPos);
  if (list?.type.name !== LIST) return;
  view.dispatch(appendRow(state, state.tr, listPos + list.nodeSize - 1).scrollIntoView());
  view.focus();
}

/** A clipboard slice as one run of inline content: block boundaries become a single space, valid marks stay. */
function flattenToInline(slice: Slice, cell: PMNode): Slice {
  const out: PMNode[] = [];
  const space = (schema: PMNode["type"]["schema"]) => schema.text(" ");
  const push = (node: PMNode) => {
    const marks = node.marks.filter((mark) => cell.type.allowsMarkType(mark.type));
    out.push(node.mark(marks));
  };
  const visit = (node: PMNode) => {
    if (node.type.name === "hardBreak") return out.push(space(node.type.schema)), undefined;
    if (node.isInline) return push(node);
    node.forEach((child, _offset, index) => {
      if (index > 0 && !child.isInline) out.push(space(node.type.schema));
      visit(child);
    });
    return undefined;
  };
  slice.content.forEach((node, _offset, index) => {
    if (index > 0 && !node.isInline) out.push(space(node.type.schema));
    visit(node);
  });
  const text = Fragment.fromArray(out.filter((node, i) => !(node.isText && node.text === " " && (i === 0 || i === out.length - 1))));
  return new Slice(text, 0, 0);
}

/**
 * Insert a clipboard/drop slice into the cell at `at` as one inline run; false when `at` is not in a key/value.
 * `moved` (a drag inside the editor) removes the dragged selection first.
 */
export function insertFlattenedIntoCell(view: EditorView, at: number, slice: Slice, moved = false): boolean {
  const { state } = view;
  const $at = state.doc.resolve(at);
  if (slice.content.childCount === 0 || !isInPropertyCell($at)) return false;
  // Nothing inline to keep (an image, a divider): swallow the drop and change nothing.
  if (flattenToInline(slice, $at.parent).content.size === 0) return true;
  const tr = state.tr;
  let target = at;
  if (moved && !state.selection.empty) {
    tr.deleteSelection();
    target = tr.mapping.map(at);
  }
  const $target = tr.doc.resolve(target);
  if (!isInPropertyCell($target)) return false;
  const flat = flattenToInline(slice, $target.parent);
  tr.insert(target, flat.content).setMeta("uiEvent", "drop");
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, target + flat.content.size)).scrollIntoView());
  return true;
}

export const DocPropertyKeys = Extension.create({
  name: "docPropertyKeys",
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // A key/value is one inline run: pasted paragraphs would otherwise split the list around the cell.
          // Only a paste whose target is the selection inside one cell is flattened.
          handlePaste: (view, _event, slice) => {
            const { $from, $to } = view.state.selection;
            if (slice.content.childCount === 0 || !locate($from) || !$from.sameParent($to)) return false;
            const flat = flattenToInline(slice, $from.parent);
            // Nothing inline to keep (an image, a divider): leave the selection as it is.
            if (flat.content.size === 0) return true;
            view.dispatch(view.state.tr.replaceSelection(flat).setMeta("paste", true).setMeta("uiEvent", "paste").scrollIntoView());
            return true;
          },
          // A drop is flattened only when it lands in a cell, wherever the caret is.
          handleDrop: (view, event, slice, moved) => {
            const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
            return hit ? insertFlattenedIntoCell(view, hit.pos, slice, moved) : false;
          },
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    const run = (fn: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean) => () => fn(this.editor.state, this.editor.view.dispatch);
    return {
      Enter: run(onEnter),
      Tab: run((s, d) => onTab(s, d, false)),
      "Shift-Tab": run((s, d) => onTab(s, d, true)),
      Backspace: run(onBackspace),
    };
  },
});
