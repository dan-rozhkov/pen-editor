import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";

import { cn } from "@/lib/utils";

/** Grey track that holds the items. */
export const SEGMENTED_TRACK_CLASS =
  "inline-flex w-fit items-center gap-0.5 rounded-control-lg bg-secondary p-[3px]";

/** One item, inactive. */
export const SEGMENTED_ITEM_CLASS =
  "inline-flex h-6 cursor-default items-center justify-center rounded-control-inset border border-transparent px-2.5 text-xs/relaxed font-medium whitespace-nowrap text-text-muted outline-none transition-[color,background-color,border-color,box-shadow,scale] select-none hover:text-text-primary focus-visible:ring-[2px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Checked state for Base UI radios (variant-prefixed, so it sorts after the border). */
export const SEGMENTED_ITEM_CHECKED_CLASS =
  "data-checked:control-raised dark:data-checked:bg-surface-hover data-checked:text-text-primary data-disabled:cursor-not-allowed data-disabled:opacity-50";

/**
 * Active state as plain classes (toggle buttons driven by aria-pressed or
 * props). The explicit `border-menu-border` is needed: a plain
 * `border-transparent` otherwise beats the border colour in `control-raised`.
 */
export const SEGMENTED_ITEM_ACTIVE_CLASS =
  "bg-surface-panel control-raised border-menu-border dark:bg-surface-hover text-text-primary hover:bg-surface-panel dark:hover:bg-surface-hover";

/**
 * Inactive state for items built on `Button`/`IconButton`: explicitly clears
 * the variant's fill and elevation so any variant renders the same.
 */
export const SEGMENTED_ITEM_INACTIVE_CLASS = "bg-transparent shadow-none";

/** Extra classes for an icon-only item. */
export const SEGMENTED_ITEM_ICON_CLASS = "px-1.5 [&_svg]:size-4";

/**
 * Classes for one item of a segmented row built from plain buttons. Also safe
 * on `Button`/`IconButton` (their hover background is reset).
 */
export function segmentedItemClass(
  active: boolean | undefined,
  options: { icon?: boolean; className?: string } = {},
): string {
  return cn(
    SEGMENTED_ITEM_CLASS,
    "hover:bg-transparent dark:hover:bg-transparent",
    options.icon && SEGMENTED_ITEM_ICON_CLASS,
    active ? SEGMENTED_ITEM_ACTIVE_CLASS : SEGMENTED_ITEM_INACTIVE_CLASS,
    options.className,
  );
}

/**
 * Classes for a stand-alone toggle (one button, no track): the same 24px
 * raised-when-active look as a segmented item, without the grey well. Use on
 * a `size="icon-sm"` `IconButton`.
 */
export function segmentedToggleClass(active: boolean | undefined, className?: string): string {
  return cn(
    "text-text-muted hover:text-text-primary",
    active ? SEGMENTED_ITEM_ACTIVE_CLASS : SEGMENTED_ITEM_INACTIVE_CLASS,
    className,
  );
}

/**
 * Classes for an action button (no persistent state) inside a track: a
 * transparent item that fills with the panel colour on hover.
 */
export function segmentedActionClass(options: { icon?: boolean; className?: string } = {}): string {
  return segmentedItemClass(false, {
    icon: options.icon,
    className: cn("hover:bg-surface-panel dark:hover:bg-surface-hover", options.className),
  });
}

/**
 * The track as a `role="group"` for toggle buttons. Pass `aria-label` to name
 * it for assistive tech; the group has no visible label of its own.
 */
function SegmentedGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div role="group" data-slot="segmented-group" className={cn(SEGMENTED_TRACK_CLASS, className)} {...props} />;
}

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Names the group for assistive tech (there is no visible label of its own). */
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}

/**
 * A row of mutually exclusive options. Radio-group semantics from Base UI:
 * one tab stop, arrow keys move and select, Home/End jump.
 */
function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  disabled,
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <RadioGroup
      data-slot="segmented-control"
      aria-label={props["aria-label"]}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
      className={cn(SEGMENTED_TRACK_CLASS, className)}
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          data-slot="segmented-control-item"
          className={cn(SEGMENTED_ITEM_CLASS, SEGMENTED_ITEM_CHECKED_CLASS)}
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

export { SegmentedControl, SegmentedGroup };
