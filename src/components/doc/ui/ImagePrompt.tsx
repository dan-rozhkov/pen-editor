import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { IMAGE_PROMPT_EVENT } from "../slash/slashItems";
import { MENU_INPUT, MENU_SURFACE } from "./menuSurface";

const WIDTH = 288;

/** Small URL field under the caret, opened by the slash menu's "Image" item. */
export function ImagePrompt({ editor }: { editor: Editor }) {
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    const dom = editor.view.dom;
    const open = () => {
      const caret = editor.view.coordsAtPos(editor.state.selection.from);
      setValue("");
      setAnchor({ left: Math.max(8, Math.min(caret.left, window.innerWidth - WIDTH - 8)), top: caret.bottom + 6 });
    };
    dom.addEventListener(IMAGE_PROMPT_EVENT, open);
    return () => dom.removeEventListener(IMAGE_PROMPT_EVENT, open);
  }, [editor]);

  if (!anchor) return null;
  const close = () => setAnchor(null);
  return createPortal(
    <form
      className={cn(MENU_SURFACE, "fixed z-[10050] p-1.5")}
      style={{ left: anchor.left, top: anchor.top, width: WIDTH }}
      onSubmit={(event) => {
        event.preventDefault();
        const src = value.trim();
        close();
        if (src) editor.chain().focus().setImage({ src }).run();
        else editor.commands.focus();
      }}
    >
      <Input
        autoFocus
        className={MENU_INPUT}
        aria-label="Image address"
        placeholder="Paste an image link, then press Enter"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          close();
          editor.commands.focus();
        }}
      />
    </form>,
    document.body,
  );
}
