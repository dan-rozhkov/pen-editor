import { Fragment, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { MENU_SURFACE } from "../ui/menuSurface";
import { useListNav, type SuggestionMenuHandle } from "../ui/useListNav";
import type { SlashItem } from "./slashItems";

export type SlashMenuHandle = SuggestionMenuHandle;

interface Props {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

export const SlashMenu = forwardRef<SlashMenuHandle, Props>(function SlashMenu({ items, command }, ref) {
  const { selected, setSelected, listRef } = useListNav(ref, { items, onPick: command, resetKey: items });

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
          <Fragment key={item.id}>
            {item.group && item.group !== items[index - 1]?.group && (
              <div className="px-2 pt-2 pb-1 text-[0.6875rem] font-medium text-popover-foreground/60">{item.group}</div>
            )}
            <div
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
          </Fragment>
        ))
      )}
    </div>
  );
});
