import * as React from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipShortcut,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { VariantProps } from "class-variance-authority";
import type { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

type Side = TooltipPrimitive.Positioner.Props["side"];
type Align = TooltipPrimitive.Positioner.Props["align"];

export interface IconButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "children">,
    VariantProps<typeof buttonVariants> {
  /** Action name shown in the tooltip, e.g. "Move", "Duplicate". */
  tooltip: string;
  /**
   * Pre-formatted hotkey, e.g. "V" or `formatShortcut(["mod", "G"])`.
   * Shown next to the label in the tooltip when present.
   */
  shortcut?: string;
  /** Tooltip placement relative to the trigger. @default "bottom" */
  side?: Side;
  /** Tooltip alignment along that side. @default "center" */
  align?: Align;
  children: React.ReactNode;
}

/**
 * Icon-only button with a built-in tooltip (action name + optional hotkey).
 * Wraps the shared `Button` — pass the same `variant`/`size`/`className`
 * props you'd give `Button`, plus `tooltip` (required) and `shortcut`
 * (optional, already formatted — see `formatShortcut`).
 *
 * Renders only the Base UI tooltip popup for hover/focus discoverability.
 * A native `title` is deliberately *not* set here — it would pop its own
 * browser tooltip alongside this one. `aria-label` defaults to `tooltip`
 * (overridable) and remains the accessible name for assistive tech.
 *
 * Relies on a single `TooltipProvider` mounted at the app root (`App.tsx`)
 * for shared open/close delay grouping — do not wrap this in another one.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      tooltip,
      shortcut,
      side = "bottom",
      align = "center",
      "aria-label": ariaLabel,
      ...buttonProps
    },
    ref,
  ) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button ref={ref} aria-label={ariaLabel ?? tooltip} {...buttonProps} />
          }
        />
        <TooltipContent side={side} align={align}>
          <span>{tooltip}</span>
          {shortcut && <TooltipShortcut>{shortcut}</TooltipShortcut>}
        </TooltipContent>
      </Tooltip>
    );
  },
);
