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
        <div className="px-2.5 py-1.5 text-[13px] text-menu-muted-foreground">No results</div>
      ) : (
        items.map((item, index) => (
          <Fragment key={item.id}>
            {item.group && item.group !== items[index - 1]?.group && (
              <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-menu-muted-foreground">{item.group}</div>
            )}
            <div
              role="option"
              aria-selected={index === selected}
              className="text-menu-foreground flex cursor-default items-center gap-2.5 rounded-[10px] px-2 py-1.5 aria-selected:bg-menu-highlight aria-selected:text-menu-foreground"
              onMouseMove={() => setSelected(index)}
              onClick={() => command(item)}
            >
              <span className="ring-menu-border bg-menu flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 [&_svg]:size-4">
                {item.icon}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] leading-5 font-medium">{item.title}</span>
                <span className="block truncate text-[11px] text-menu-muted-foreground">{item.hint}</span>
              </span>
            </div>
          </Fragment>
        ))
      )}
    </div>
  );
});
