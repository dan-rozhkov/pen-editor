"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { DotsSixIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import {
  clampPositionToViewport,
  computeDragPosition,
  type DragOrigin,
  type Point,
} from "@/components/ui/popoverDrag";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  align = "start",
  alignOffset = 0,
  side = "left",
  sideOffset = 8,
  className,
  draggable = false,
  children,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    /**
     * Opt-in Figma-style tear-off: renders a drag handle above the content
     * and lets the user grab it to place the popover anywhere on screen,
     * switching from trigger-anchored positioning to a fixed viewport
     * position clamped to stay on screen (see `popoverDrag.ts`). Not the
     * native HTML5 `draggable` attribute — this never reaches the DOM.
     * Position always resets to anchored on the next open: the popover
     * subtree unmounts on close (no `keepMounted`), taking this component's
     * local drag state with it.
     */
    draggable?: boolean;
  }) {
  const positionerRef = useRef<HTMLDivElement>(null);
  const [tornOffPosition, setTornOffPosition] = useState<Point | null>(null);
  // Cleanup for the in-progress drag's window listeners. Held in a ref so
  // pointerup/pointercancel AND an unmount-mid-drag can all tear it down —
  // otherwise an interrupted gesture (e.g. touch pointercancel, or the popover
  // dismissing while dragging) would leak listeners that keep tracking the
  // pointer on the next interaction.
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const handleDragHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const positionerEl = positionerRef.current;
      if (!positionerEl) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      // Clear any prior drag that never received its pointerup.
      dragCleanupRef.current?.();

      const rect = positionerEl.getBoundingClientRect();
      const origin: DragOrigin = {
        pointer: { x: event.clientX, y: event.clientY },
        position: { x: rect.left, y: rect.top },
      };
      const size = { width: rect.width, height: rect.height };
      // Tear off immediately at the current (anchored) position — no visual
      // jump before the first pointer move.
      setTornOffPosition(origin.position);

      const onMove = (moveEvent: PointerEvent) => {
        setTornOffPosition(
          computeDragPosition(
            origin,
            { x: moveEvent.clientX, y: moveEvent.clientY },
            size,
            { width: window.innerWidth, height: window.innerHeight },
          ),
        );
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        dragCleanupRef.current = null;
      };
      dragCleanupRef.current = cleanup;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [],
  );

  // Tear down a drag that is still active when the popover unmounts (e.g.
  // dismissed mid-drag), so its window listeners don't outlive the component.
  useEffect(() => () => dragCleanupRef.current?.(), []);

  // Keep a torn-off popover on screen when the viewport shrinks (window resize
  // / orientation change), matching the clamp applied during the drag itself.
  const isTornOff = tornOffPosition !== null;
  useEffect(() => {
    if (!isTornOff) return;
    const onResize = () => {
      const positionerEl = positionerRef.current;
      if (!positionerEl) return;
      const rect = positionerEl.getBoundingClientRect();
      setTornOffPosition((current) =>
        current
          ? clampPositionToViewport(
              current,
              { width: rect.width, height: rect.height },
              { width: window.innerWidth, height: window.innerHeight },
            )
          : current,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isTornOff]);

  const positionerStyle = tornOffPosition
    ? {
        position: "fixed" as const,
        top: tornOffPosition.y,
        left: tornOffPosition.x,
        right: "auto",
        bottom: "auto",
        transform: "none",
      }
    : undefined;

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        ref={positionerRef}
        className="isolate z-[10050] outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        style={positionerStyle}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            // Mirrors the existing color-picker popover surface so all popovers
            // in the editor read as the same object.
            "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 z-50 flex w-[220px] flex-col gap-2 rounded-xl border border-border-light bg-surface-panel p-3 text-text-primary shadow-lg duration-100 outline-none",
            className,
          )}
          {...props}
        >
          {draggable && (
            // Plain in-flow bar (no edge-bleed negative margins) so it looks
            // right regardless of a consumer's own padding overrides (e.g.
            // TypographySection's text-styles popover uses `p-0`).
            <div
              data-slot="popover-drag-handle"
              role="presentation"
              title="Drag to move"
              className="flex h-4 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-md text-text-muted transition-colors hover:bg-secondary hover:text-text-primary active:cursor-grabbing"
              onPointerDown={handleDragHandlePointerDown}
            >
              <DotsSixIcon size={14} weight="bold" className="rotate-90" />
            </div>
          )}
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
