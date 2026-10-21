import { useEffect } from "react";
import type { Editor } from "@tiptap/core";

/** The close callback of the one property/callout popover that is open right now. */
let activeClose: (() => void) | null = null;

/**
 * Shared behaviour of the popovers anchored to a node view (property type menu, callout kind menu):
 * at most one is open at a time, and Escape anywhere on the page closes it and hands focus back to the editor
 * (selection untouched, so the caret stays where it was). The listener exists only while the popover is open,
 * so a closed popover never reacts to keys typed in the editor.
 */
export function useTransientPopover(open: boolean, close: () => void, editor: Editor): void {
  useEffect(() => {
    if (!open) return;
    if (activeClose && activeClose !== close) activeClose();
    activeClose = close;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      editor.commands.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (activeClose === close) activeClose = null;
    };
  }, [open, close, editor]);
}
