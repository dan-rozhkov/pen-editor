import type { Editor } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { DocColor } from "../docPalette";

// One transaction (one undo step) that rewrites the value cell of the property row at `rowPos`.
// The key is never touched; afterwards the caret sits at the end of the value and the editor has focus.

function valueContentRange(editor: Editor, rowPos: number): { from: number; to: number } | null {
  const row = editor.state.doc.nodeAt(rowPos);
  const key = row?.type.name === "propertyRow" ? row.firstChild : null;
  const value = row?.lastChild;
  if (!row || !key || !value || value.type.name !== "propertyValue") return null;
  const from = rowPos + 1 + key.nodeSize + 1;
  return { from, to: from + value.content.size };
}

function rewriteValue(editor: Editor, rowPos: number, build: (editor: Editor) => Fragment): boolean {
  const range = valueContentRange(editor, rowPos);
  if (!range) return false;
  const content = build(editor);
  const tr = editor.state.tr.replaceWith(range.from, range.to, content);
  tr.setSelection(TextSelection.near(tr.doc.resolve(range.from + content.size), -1));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

/** Plain text, no marks; empty text clears the value. */
export function setPropertyText(editor: Editor, rowPos: number, text: string): boolean {
  return rewriteValue(editor, rowPos, ({ schema }) => (text ? Fragment.from(schema.text(text)) : Fragment.empty));
}

export function setPropertyDate(editor: Editor, rowPos: number, isoDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) && setPropertyText(editor, rowPos, isoDate);
}

/** A single text run with a docColor background (the palette NAME), serialised as `<span data-bg="name">`. */
export function setPropertyOption(editor: Editor, rowPos: number, text: string, color: DocColor): boolean {
  const label = text.trim();
  if (!label) return false;
  return rewriteValue(editor, rowPos, ({ schema }) =>
    Fragment.from(schema.text(label, [schema.marks.docColor.create({ color: null, background: color })])),
  );
}

export function clearProperty(editor: Editor, rowPos: number): boolean {
  return setPropertyText(editor, rowPos, "");
}
