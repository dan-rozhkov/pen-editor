import * as React from "react";

import { cn } from "@/lib/utils";

/** One key chip, e.g. `<Kbd>⌘</Kbd>`. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-default bg-surface-elevated px-1 font-mono text-[0.6875rem] leading-none font-medium text-text-secondary select-none",
        className,
      )}
      {...props}
    />
  );
}

/** A row of `Kbd` chips forming one shortcut. */
function KbdGroup({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="kbd-group" className={cn("inline-flex items-center gap-1", className)} {...props} />;
}

export { Kbd, KbdGroup };
