import { CameraIcon, FlagIcon } from "@phosphor-icons/react";
import type { BrowseTrace, BrowseTraceFrame } from "@sideform/browser-agent/agent/session";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { EmptyNote, FRAME_SURFACE, StatusDot } from "./parts";
import type { Playback } from "./usePlayback";
import { keepInView } from "./keepInView";
import { TimelineAxis } from "./TimelineAxis";
import { TransportBar } from "./TransportBar";
import { buildTimeline, formatOffset, spreadPositions, stepOfFrame, type Timeline } from "./traceModel";

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
  player: PlayerView;
}

/** What the transport bar and the playhead need from the player. */
export type PlayerView = Pick<Playback, "time" | "playing" | "speed" | "pace"> & {
  onTogglePlay(): void;
  onSeek(time: number): void;
  onSpeedChange(speed: Playback["speed"]): void;
  onPaceChange(pace: Playback["pace"]): void;
};

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

interface ThumbsProps {
  trace: BrowseTrace;
  timeline: Timeline;
  lefts: number[];
  selectedFrameId: number | undefined;
  flagged: Set<number>;
  onSelectFrame(frame: BrowseTraceFrame): void;
}

/** The thumbnails; memoized so a moving playhead does not re-render them. */
const Thumbnails = memo(function Thumbnails({ trace, timeline, lefts, selectedFrameId, flagged, onSelectFrame }: ThumbsProps) {
  const count = timeline.frames.length;
  return count === 0 ? (
    <EmptyNote title="No frames were captured in this run." className="flex h-[52px] items-center" />
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
            data-space-plays
            onClick={() => onSelectFrame(frame)}
            className={cn(
              "group absolute top-0.5 overflow-hidden rounded-md outline-none",
              "focus-visible:ring-2 focus-visible:ring-accent-primary/70",
              active ? "shadow-[0_0_0_2px_var(--color-accent-primary)]" : "opacity-80 hover:opacity-100",
            )}
            style={{ left: lefts[i], width: THUMB_W, height: THUMB_H }}
          >
            <img
              src={frame.src}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className={cn("size-full rounded-md object-cover object-top", FRAME_SURFACE)}
            />
            {Kind && (
              <span className="absolute start-1 bottom-1 flex size-4 items-center justify-center rounded bg-black/60 text-white">
                <Kind weight="fill" className="size-2.5" />
              </span>
            )}
            {bad && <StatusDot tone="danger" className="absolute end-1 top-1 size-2 ring-2 ring-white dark:ring-black/60" />}
          </button>
        );
      })}
    </div>
  );
});

export function Filmstrip({ trace, selectedFrameId, selectedStep, flagged, onSelectFrame, onSelectStep, player }: Props) {
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
    keepInView(scrollRef.current?.querySelector<HTMLElement>('[aria-current="true"]'), "x");
  }, [selectedFrameId]);

  const offset = Math.min(timeline.span, Math.max(0, player.time - trace.startedAt));
  return (
    <section aria-label="Filmstrip" className="shrink-0 border-b border-border-default bg-surface-panel">
      <TransportBar
        playing={player.playing}
        offset={offset}
        span={timeline.span}
        speed={player.speed}
        pace={player.pace}
        onTogglePlay={player.onTogglePlay}
        onSpeedChange={player.onSpeedChange}
        onPaceChange={player.onPaceChange}
      />
      <div ref={scrollRef} className="overflow-x-auto px-4 pt-1 pb-2">
        <div className="relative" style={{ width }}>
          <Thumbnails trace={trace} timeline={timeline} lefts={lefts} selectedFrameId={selectedFrameId} flagged={flagged} onSelectFrame={onSelectFrame} />
          <TimelineAxis
            timeline={timeline}
            startedAt={trace.startedAt}
            offset={offset}
            selectedStep={selectedStep}
            onSelectStep={onSelectStep}
            onSeek={player.onSeek}
          />
        </div>
      </div>
    </section>
  );
}
