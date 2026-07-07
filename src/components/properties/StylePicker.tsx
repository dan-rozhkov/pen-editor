import { LinkSimpleIcon, LinkBreakIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StyleOption {
  id: string;
  name: string;
}

interface StylePickerProps {
  /** All styles the user can pick from. */
  styles: StyleOption[];
  /** The style this paint/node is currently bound to, if any. */
  boundId?: string;
  onPick: (styleId: string) => void;
  onDetach: () => void;
  /** Verb shown on the trigger when nothing is bound (e.g. "fill style"). */
  kindLabel: string;
}

/**
 * Compact "bind to a named style" control for the fill/effect editors. When
 * bound it shows the style name + a Detach button (which freezes the resolved
 * value inline via the store). When unbound it offers a dropdown of styles.
 * Renders nothing when there are no styles and nothing is bound.
 */
export function StylePicker({ styles, boundId, onPick, onDetach, kindLabel }: StylePickerProps) {
  const bound = boundId ? styles.find((s) => s.id === boundId) : undefined;

  if (boundId) {
    return (
      <div className="flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-1">
        <LinkSimpleIcon className="size-3.5 shrink-0 text-accent-primary" />
        <span className="min-w-0 flex-1 truncate text-xs text-text-primary" title={bound?.name}>
          {bound?.name ?? "Missing style"}
        </span>
        <Button variant="ghost" size="icon-sm" onClick={onDetach} title="Detach style">
          <LinkBreakIcon />
        </Button>
      </div>
    );
  }

  if (styles.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" title={`Apply a ${kindLabel}`} />}
      >
        <LinkSimpleIcon className="size-3.5" />
        <span className="text-xs">Apply {kindLabel}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {styles.map((s) => (
          <DropdownMenuItem key={s.id} className="text-xs cursor-pointer" onClick={() => onPick(s.id)}>
            {s.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
