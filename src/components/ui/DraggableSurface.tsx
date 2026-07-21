import type { ComponentProps, ReactNode } from "react";
import { DotsSixIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

/** Shared chrome for floating editor surfaces such as draggable popovers and
 * plugin panels. Keeping it here prevents those two surfaces from drifting
 * apart visually. */
export const DRAGGABLE_SURFACE_CLASS =
  "rounded-xl border border-border-light bg-surface-panel text-text-primary shadow-lg outline-none";

interface DraggableSurfaceHandleProps extends Omit<ComponentProps<"div">, "children"> {
  children?: ReactNode;
}

export function DraggableSurfaceHandle({
  children,
  className,
  title = "Drag to move",
  ...props
}: DraggableSurfaceHandleProps) {
  return (
    <div
      data-slot="popover-drag-handle"
      role="presentation"
      title={title}
      className={cn(
        "flex h-4 shrink-0 cursor-grab touch-none select-none items-center rounded-md text-text-muted transition-colors hover:text-text-primary active:cursor-grabbing",
        children ? "gap-1.5" : "justify-center",
        className,
      )}
      {...props}
    >
      <DotsSixIcon size={14} weight="bold" className="rotate-90" />
      {children}
    </div>
  );
}
