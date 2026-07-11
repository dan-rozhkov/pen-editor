"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

// One TooltipProvider is mounted at the app root (see `App.tsx`); do not
// nest another one here. It shares hover-delay grouping across every
// tooltip so moving between adjacent icon buttons doesn't re-trigger the
// opening delay.
const TooltipProvider = TooltipPrimitive.Provider;

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "bottom",
  align = "center",
  sideOffset = 6,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        className="isolate z-[10060] outline-none"
        align={align}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={8}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 flex items-center gap-1.5 rounded-md bg-popover text-popover-foreground px-2 py-1 text-xs shadow-lg ring-1 ring-foreground/10 duration-100 outline-none",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

/**
 * Muted key-cap style shortcut hint rendered inside a `TooltipContent`.
 * Colors are hand-tuned against the tooltip's always-dark `bg-popover`
 * surface (see `TooltipContent`) rather than the theme-flipping
 * `text-text-muted`/`border-*` tokens, which would go low-contrast in the
 * light app theme once the popup itself stopped flipping with it.
 */
function TooltipShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="tooltip-shortcut"
      className={cn(
        "rounded border border-white/15 bg-white/10 px-1 py-0.5 font-mono text-popover-foreground/70",
        className,
      )}
      {...props}
    />
  );
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TooltipShortcut,
};
