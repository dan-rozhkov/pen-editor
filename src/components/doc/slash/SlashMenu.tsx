import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import { cn } from "@/lib/utils";
import { MENU_SURFACE } from "../ui/menuSurface";
import type { SlashItem } from "./slashItems";

export interface SlashMenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface Props {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

export const SlashMenu = forwardRef<SlashMenuHandle, Props>(function SlashMenu({ items, command }, ref) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelected(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setSelected((selected + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((selected + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        command(items[selected]);
        return true;
      }
      return false;
    },
  }));

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Insert block"
      className={cn(MENU_SURFACE, "max-h-80 w-64 overflow-y-auto p-1")}
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-popover-foreground/60">No results</div>
      ) : (
        items.map((item, index) => (
          <div
            key={item.id}
            role="option"
            aria-selected={index === selected}
            className="flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 aria-selected:bg-accent aria-selected:text-accent-foreground"
            onMouseMove={() => setSelected(index)}
            onClick={() => command(item)}
          >
            <span className="bg-popover-foreground/10 flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4">
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium">{item.title}</span>
              <span className="block truncate text-[0.6875rem] text-popover-foreground/60">{item.hint}</span>
            </span>
          </div>
        ))
      )}
    </div>
  );
});
