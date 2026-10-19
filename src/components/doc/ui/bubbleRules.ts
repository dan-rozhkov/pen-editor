import { NodeSelection, type EditorState } from "@tiptap/pm/state";

/**
 * Whether the selection bubble may show: a non-empty TEXT selection, outside
 * code blocks, never a node selection (image, divider, block-handle drag).
 */
export function bubbleVisible(state: EditorState, active: boolean, editable = true): boolean {
  const { selection } = state;
  if (!editable || !active || selection.empty || selection instanceof NodeSelection) return false;
  if (selection.$from.parent.type.spec.code || selection.$to.parent.type.spec.code) return false;
  return state.doc.textBetween(selection.from, selection.to).length > 0;
}

/**
 * Popups (link, colour, turn-into) render in portals. While one is open the bubble
 * must not hide when focus leaves the editor, so each open popup is "held".
 */
export function createHolds() {
  const keys = new Set<string>();
  return {
    any: () => keys.size > 0,
    /** A popup's open-change handler: records the hold, then forwards the state. */
    handler: (key: string, set?: (open: boolean) => void) => (open: boolean) => {
      if (open) keys.add(key);
      else keys.delete(key);
      set?.(open);
    },
  };
}
