import { CameraIcon, FlagIcon } from "@phosphor-icons/react";
import type { BrowseTrace, BrowseTraceFrame } from "@sideform/browser-agent/agent/session";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buildTimeline, formatOffset, spreadPositions, stepOfFrame } from "./traceModel";

const THUMB_W = 76;
const THUMB_H = 48;
const GAP = 8;

interface Props {
  trace: BrowseTrace;
  selectedFrameId: number | undefined;
  selectedStep: number | null;
  flagged: Set<number>;
  onSelectFrame(frame: BrowseTraceFrame): void;
  onSelectStep(index: number): void;
}

/** Width of an element, tracked with a ResizeObserver (a fixed guess where there is none). */
function useWidth(ref: React.RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width || fallback));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, fallback]);
  return width;
}

export function Filmstrip({ trace, selectedFrameId, selectedStep, flagged, onSelectFrame, onSelectStep }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const visible = useWidth(scrollRef, 960);
  const timeline = useMemo(() => buildTimeline(trace), [trace]);
  const count = timeline.frames.length;
  const width = Math.max(visible, count * (THUMB_W + GAP) - GAP);
  const lefts = useMemo(
    () => spreadPositions(timeline.frames.map((f) => (f.pct / 100) * width), THUMB_W, GAP, width),
    [timeline, width],
  );

  useEffect(() => {
    scrollRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedFrameId]);

  return (
    <section aria-label="Filmstrip" className="shrink-0 border-b border-border-default bg-surface-panel">
      <div ref={scrollRef} className="overflow-x-auto px-4 pt-3 pb-1.5">
        <div className="relative" style={{ width }}>
          {count === 0 ? (
            <p className="flex h-[52px] items-center text-xs text-text-muted">No frames were captured in this run.</p>
          ) : (
            <div className="relative" style={{ height: THUMB_H + 4 }}>
              {timeline.frames.map(({ frame }, i) => {
                const step = stepOfFrame(trace, frame);
                const active = frame.id === selectedFrameId;
                const bad = step !== undefined && flagged.has(step);
                const Kind = frame.kind === "final" ? FlagIcon : frame.kind === "screenshot" ? CameraIcon : null;
                return (
                  <button
                    key={frame.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    aria-label={`Frame ${i + 1}, ${formatOffset(frame.at - trace.startedAt)}${bad ? ", has errors" : ""}`}
                    title={formatOffset(frame.at - trace.startedAt)}
                    onClick={() => onSelectFrame(frame)}
                    className={cn(
                      "group absolute top-0.5 overflow-hidden rounded-md outline-none transition-[box-shadow,translate,opacity] duration-150 ease-out motion-reduce:transition-none",
                      "focus-visible:ring-2 focus-visible:ring-accent-primary/70",
                      active ? "shadow-[0_0_0_2px_var(--color-accent-primary)]" : "opacity-80 hover:-translate-y-px hover:opacity-100",
                    )}
                    style={{ left: lefts[i], width: THUMB_W, height: THUMB_H }}
                  >
                    <img
                      src={frame.src}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      className="size-full rounded-md bg-white object-cover object-top outline outline-1 -outline-offset-1 outline-[oklch(0_0_0/0.1)] dark:outline-[oklch(1_0_0/0.1)]"
                    />
                    {Kind && (
                      <span className="absolute start-1 bottom-1 flex size-4 items-center justify-center rounded bg-black/60 text-white">
                        <Kind weight="fill" className="size-2.5" />
                      </span>
                    )}
                    {bad && <span className="absolute end-1 top-1 size-2 rounded-full bg-destructive ring-2 ring-white dark:ring-black/60" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Time axis: step spans, frame markers, ticks. */}
          <div className="relative mt-2 h-2 rounded-full bg-surface-elevated" data-testid="trace-axis">
            {timeline.steps.map((s) => (
              <button
                key={s.index}
                type="button"
                tabIndex={-1}
                aria-label={`Step ${s.index + 1}`}
                onClick={() => onSelectStep(s.index)}
                className={cn(
                  "absolute inset-y-0 rounded-full transition-colors duration-150 motion-reduce:transition-none",
                  s.index === selectedStep ? (s.ok ? "bg-accent-primary" : "bg-destructive") : s.ok ? "bg-accent-primary/30 hover:bg-accent-primary/50" : "bg-destructive/40 hover:bg-destructive/60",
                )}
                style={{ left: `${s.startPct}%`, width: `${s.widthPct}%` }}
              />
            ))}
            {timeline.frames.map(({ frame, pct }) => (
              <span
                key={frame.id}
                aria-hidden
                className={cn(
                  "pointer-events-none absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-panel",
                  frame.id === selectedFrameId ? "bg-text-primary" : "bg-text-muted",
                )}
                style={{ left: `${pct}%` }}
              />
            ))}
          </div>
          <div aria-hidden className="relative mt-1 h-4">
            {timeline.ticks.map((tick, i) => (
              <span
                key={tick.pct}
                className={cn(
                  "absolute text-[10px] tabular-nums text-text-muted",
                  i === 0 ? "" : i === timeline.ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
                )}
                style={{ left: `${tick.pct}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
