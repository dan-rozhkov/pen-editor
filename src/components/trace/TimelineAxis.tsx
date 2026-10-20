import { useRef } from "react";
import { cn } from "@/lib/utils";
import { formatClock, type Timeline } from "./traceModel";

/** A pointer must move this far (px) from a step span before a press turns into a drag. */
const DRAG_THRESHOLD = 3;
/** Arrow keys on the playhead move it this share of the run; shift moves it ten times as far. */
const KEY_STEP = 0.01;
const SLIDER_BACK = new Set(["ArrowLeft", "ArrowDown", "PageDown"]);
const SLIDER_FORWARD = new Set(["ArrowRight", "ArrowUp", "PageUp"]);

interface Props {
  timeline: Timeline;
  startedAt: number;
  /** Playhead, ms from the run start. */
  offset: number;
  selectedStep: number | null;
  onSelectStep(index: number): void;
  /** The user moved the playhead (drag, click, keys). */
  onSeek(time: number): void;
}

/** The time axis: step spans, the draggable playhead and the start and end labels. */
export function TimelineAxis({ timeline, startedAt, offset, selectedStep, onSelectStep, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; id: number; dragging: boolean } | null>(null);
  const swallowClick = useRef(false);
  const { span } = timeline;

  const seekAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    onSeek(startedAt + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * span);
  };
  const capture = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // The pointer is already gone; the drag simply ends.
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    swallowClick.current = false;
    const onSpan = (e.target as HTMLElement).closest("[data-span]") !== null;
    press.current = { x: e.clientX, id: e.pointerId, dragging: !onSpan };
    if (!onSpan) {
      capture(e);
      seekAt(e.clientX);
      // Keep the playhead focusable by keyboard once it has been used with the mouse.
      e.preventDefault();
      trackRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const current = press.current;
    if (!current || current.id !== e.pointerId) return;
    if (!current.dragging) {
      // A press that began on a step span is a click until it moves.
      if (Math.abs(e.clientX - current.x) < DRAG_THRESHOLD) return;
      current.dragging = true;
      swallowClick.current = true;
      capture(e);
    }
    seekAt(e.clientX);
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (press.current?.id === e.pointerId) press.current = null;
    // A drag captured by the track ends in a click that never reaches the span: forget it.
    if (swallowClick.current) setTimeout(() => (swallowClick.current = false), 0);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const unit = (e.shiftKey || e.key === "PageUp" || e.key === "PageDown" ? 10 : 1) * KEY_STEP * span;
    const target =
      SLIDER_BACK.has(e.key) ? offset - unit
      : SLIDER_FORWARD.has(e.key) ? offset + unit
      : e.key === "Home" ? 0
      : e.key === "End" ? span
      : null;
    if (target === null) return;
    e.preventDefault();
    onSeek(startedAt + Math.min(span, Math.max(0, target)));
  };

  return (
    <>
      <div
        ref={trackRef}
        className="relative mt-2 h-1.5 touch-none rounded-full bg-surface-elevated"
        data-testid="trace-axis"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {timeline.steps.map((s) => (
          <button
            key={s.index}
            type="button"
            tabIndex={-1}
            data-span
            data-space-plays
            aria-label={`Step ${s.index + 1}`}
            onClick={() => {
              if (swallowClick.current) swallowClick.current = false;
              else onSelectStep(s.index);
            }}
            className={cn(
              "absolute inset-y-0 rounded-full",
              s.index === selectedStep ? (s.ok ? "bg-accent-primary" : "bg-destructive") : s.ok ? "bg-accent-primary/30 hover:bg-accent-primary/50" : "bg-destructive/40 hover:bg-destructive/60",
            )}
            style={{ left: `${s.startPct}%`, width: `${s.widthPct}%` }}
          />
        ))}
        {/* Playhead: above the spans and the markers. A 12px wide hit area around a 2px line. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.round(span)}
          aria-valuenow={Math.round(offset)}
          aria-valuetext={`${formatClock(offset)} of ${formatClock(span)}`}
          data-testid="trace-playhead"
          onKeyDown={onKeyDown}
          className="group/playhead absolute -inset-y-1.5 z-10 w-3 -translate-x-1/2 cursor-ew-resize outline-none"
          style={{ left: `${(offset / span) * 100}%` }}
        >
          <span aria-hidden className="absolute inset-y-0 start-1/2 w-0.5 -translate-x-1/2 rounded-full bg-text-primary group-focus-visible/playhead:bg-accent-primary" />
          <span
            aria-hidden
            className="absolute -top-0.5 start-1/2 size-2.5 -translate-x-1/2 rounded-full bg-text-primary ring-2 ring-surface-panel group-focus-visible/playhead:ring-ring"
          />
        </div>
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-[10px] tabular-nums text-text-muted">
        <span>{formatClock(0)}</span>
        <span>{formatClock(span)}</span>
      </div>
    </>
  );
}
