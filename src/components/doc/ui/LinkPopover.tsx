import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { LinkIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatShortcut } from "@/lib/commands/shortcutFormat";
import { cn } from "@/lib/utils";
import { applyLink } from "./linkHref";
import { MENU_INPUT, POPOVER_SURFACE } from "./menuSurface";

interface Props {
  editor: Editor;
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LinkPopover({ editor, active, open, onOpenChange }: Props) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <IconButton
            tooltip="Link"
            shortcut={formatShortcut(["mod", "K"])}
            variant="ghost"
            size="icon-sm"
            aria-pressed={active}
            className={active ? "bg-popover-foreground/20 text-popover-foreground" : "text-popover-foreground/70"}
          >
            <LinkIcon />
          </IconButton>
        }
      />
      <PopoverContent side="bottom" align="start" sideOffset={6} className={cn(POPOVER_SURFACE, "w-64 p-1.5")}>
        <LinkForm editor={editor} onDone={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** Mounted only while the popover is open, so the field starts from the link under the selection. */
function LinkForm({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [value, setValue] = useState(() => (editor.getAttributes("link").href as string | undefined) ?? "");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        applyLink(editor, value);
        onDone();
      }}
    >
      <Input
        autoFocus
        className={MENU_INPUT}
        aria-label="Link address"
        placeholder="Paste a link, empty to remove"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
}
