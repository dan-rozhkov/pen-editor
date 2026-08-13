import { useEffect, useRef } from "react";
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  useLeftSidebarStore,
} from "@/store/leftSidebarStore";

const KEYBOARD_STEP = 16;
const KEYBOARD_STEP_FINE = 1;

// Invisible drag handle for the left sidebar's right edge. No visible affordance
// by design — the only feedback is the ew-resize cursor on hover/drag. Kept as
// its own component so LeftSidebar.tsx doesn't grow a pointer-drag state machine.
export function LeftSidebarResizer() {
  const width = useLeftSidebarStore((s) => s.width);
  const setWidth = useLeftSidebarStore((s) => s.setWidth);
  const persistWidth = useLeftSidebarStore((s) => s.persistWidth);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const prevCursor = useRef<string | null>(null);
  const prevUserSelect = useRef<string | null>(null);

  const restoreDocumentStyles = () => {
    if (prevCursor.current !== null) {
      document.body.style.cursor = prevCursor.current;
      prevCursor.current = null;
    }
    if (prevUserSelect.current !== null) {
      document.body.style.userSelect = prevUserSelect.current;
      prevUserSelect.current = null;
    }
  };

  // Never leave a stuck cursor/selection lock behind if this unmounts mid-drag
  // (e.g. section switch while dragging).
  useEffect(() => restoreDocumentStyles, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // A second pointer landing mid-drag (touch + pen) would capture the already
    // overridden body styles as the "previous" ones and strand them there.
    if (dragState.current) return;
    // preventDefault kills the compatibility mousedown that would normally move
    // focus here, so focus the handle explicitly — otherwise its keyboard path
    // is unreachable by mouse users.
    e.preventDefault();
    e.currentTarget.focus();
    dragState.current = { startX: e.clientX, startWidth: width };
    e.currentTarget.setPointerCapture(e.pointerId);
    prevCursor.current = document.body.style.cursor;
    prevUserSelect.current = document.body.style.userSelect;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    setWidth(drag.startWidth + (e.clientX - drag.startX));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    dragState.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    restoreDocumentStyles();
    persistWidth();
  };

  const handleDoubleClick = () => {
    setWidth(LEFT_SIDEBAR_DEFAULT_WIDTH);
    persistWidth();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEYBOARD_STEP_FINE : KEYBOARD_STEP;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setWidth(width - step);
      persistWidth();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setWidth(width + step);
      persistWidth();
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={LEFT_SIDEBAR_MIN_WIDTH}
      aria-valuemax={LEFT_SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      className="absolute top-0 -right-[2px] bottom-0 w-[5px] z-10 cursor-ew-resize touch-none outline-none focus-visible:ring-[2px] focus-visible:ring-ring/50"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    />
  );
}
