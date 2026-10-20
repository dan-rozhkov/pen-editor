import type { DragEvent } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

function blockAt(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  return node ? { node, end: pos + node.nodeSize } : null;
}

/**
 * Leaf/atom blocks (image, divider) have no text: "turn into" and colour do not apply to them.
 * Neither does a property list: its cells are fixed key/value pairs, so a transform would silently fail.
 */
export function blockHasText(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  return !!node && !node.isLeaf && !node.isAtom && node.type.name !== "propertyList";
}

/**
 * The CURRENT document position of a top-level block, found from its DOM element.
 * Null when the element is no longer a top-level block of the document.
 */
export function resolveBlockPos(editor: Editor, el: HTMLElement | null): number | null {
  if (!el) return null;
  const { view } = editor;
  try {
    const p = view.posAtDOM(el, 0);
    const $p = view.state.doc.resolve(p);
    // Inside a block the top-level ancestor starts at depth 1; a leaf/atom block yields the position before it.
    const pos = $p.depth >= 1 ? $p.before(1) : p;
    return view.nodeDOM(pos) === el ? pos : null;
  } catch {
    return null;
  }
}

export function deleteBlock(editor: Editor, pos: number): boolean {
  const block = blockAt(editor, pos);
  return block ? editor.chain().focus().deleteRange({ from: pos, to: block.end }).run() : false;
}

/** Inserts a copy right below the block. */
export function duplicateBlock(editor: Editor, pos: number): boolean {
  const block = blockAt(editor, pos);
  return block ? editor.chain().focus().insertContentAt(block.end, block.node.toJSON()).run() : false;
}

/**
 * Puts the caret in an empty paragraph under the block (reusing the block when it
 * already is one) and types "/", which opens the slash menu.
 */
export function insertBelowAndOpenSlash(editor: Editor, pos: number): boolean {
  const block = blockAt(editor, pos);
  if (!block) return false;
  const reuse = block.node.type.name === "paragraph" && block.node.content.size === 0;
  const at = reuse ? pos : block.end;
  const chain = editor.chain().focus();
  if (!reuse) chain.insertContentAt(at, { type: "paragraph" });
  return chain.setTextSelection(at + 1).insertContent("/").run();
}

/**
 * Selects all text inside the block, so "turn into" and colour commands act on the whole block.
 * Leaf blocks get a NodeSelection instead, so nothing spills into a neighbouring block.
 */
export function selectBlockText(editor: Editor, pos: number): boolean {
  const block = blockAt(editor, pos);
  if (!block) return false;
  if (!blockHasText(editor, pos)) {
    return editor.commands.command(({ tr, dispatch }) => {
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      dispatch?.(tr);
      return true;
    });
  }
  return editor.commands.command(({ tr, dispatch }) => {
    const { doc } = tr;
    const from = Math.min(pos + 1, block.end - 1);
    const to = Math.max(from, block.end - 1);
    tr.setSelection(TextSelection.between(doc.resolve(from), doc.resolve(to)));
    dispatch?.(tr);
    return true;
  });
}

/** Native ProseMirror drag: select the block, hand the slice to the view, let PM handle the drop. */
export function startBlockDrag(editor: Editor, pos: number, event: DragEvent) {
  const { view } = editor;
  const selection = NodeSelection.create(view.state.doc, pos);
  view.dispatch(view.state.tr.setSelection(selection));
  const slice = selection.content();
  const { dom, text } = view.serializeForClipboard(slice);
  event.dataTransfer.clearData();
  event.dataTransfer.setData("text/html", dom.innerHTML);
  event.dataTransfer.setData("text/plain", text);
  event.dataTransfer.effectAllowed = "copyMove";
  const blockDom = view.nodeDOM(pos);
  if (blockDom instanceof HTMLElement) event.dataTransfer.setDragImage(blockDom, 0, 0);
  view.dragging = { slice, move: true };
}

export function endBlockDrag(editor: Editor): void {
  editor.view.dragging = null;
}
