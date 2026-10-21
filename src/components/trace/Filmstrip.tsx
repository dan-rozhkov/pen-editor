import { CameraIcon, FlagIcon } from "@phosphor-icons/react";
import type { BrowseTrace, BrowseTraceFrame } from "@sideform/browser-agent/agent/session";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { keepInView } from "./keepInView";
import { FRAME_SURFACE, StatusDot } from "./parts";
import type { Playback } from "./usePlayback";
import { TimelineAxis } from "./TimelineAxis";
import { TransportBar } from "./TransportBar";
import { buildTimeline, filmstripLayout, filmstripTiles, formatOffset, stepOfFrame, type Timeline } from "./traceModel";

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
  /** Tile count (at least one per frame) and the width of one tile in px. */
  n: number;
  tileW: number;
  selectedFrameId: number | undefined;
  flagged: Set<number>;
  onSelectFrame(frame: BrowseTraceFrame): void;
  /** Seeks to the middle of a repeat tile's time slot. */
  onSeekSlot(slot: number): void;
}

/** The thumbnails; memoized so a moving playhead does not re-render them. */
const Thumbnails = memo(function Thumbnails({ trace, timeline, n, tileW, selectedFrameId, flagged, onSelectFrame, onSeekSlot }: ThumbsProps) {
  const tiles = useMemo(() => filmstripTiles(timeline, n), [timeline, n]);
  // Per frame: what the label and the badges need, computed once rather than per tile.
  const info = useMemo(
    () =>
      timeline.frames.map(({ frame }) => {
        const step = stepOfFrame(trace, frame);
        return { offset: formatOffset(frame.at - trace.startedAt), bad: step !== undefined && flagged.has(step) };
      }),
    [timeline, trace, flagged],
  );
  if (tiles.length === 0) {
    return (
      <div className="flex min-h-[52px] items-center justify-center">
        <EmptyState size="panel" title="No frames were captured in this run" />
      </div>
    );
  }
  return (
    <div className="flex py-0.5" style={{ height: THUMB_H + 4, gap: GAP }}>
      {tiles.map(({ frameIndex, home }, slot) => {
        const { frame } = timeline.frames[frameIndex]!;
        const { offset, bad } = info[frameIndex]!;
        const active = frame.id === selectedFrameId;
        const Kind = frame.kind === "final" ? FlagIcon : frame.kind === "screenshot" ? CameraIcon : null;
        const picture = (
          <img
            src={frame.src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className={cn("size-full rounded-md object-cover object-top", FRAME_SURFACE)}
          />
        );
        if (!home) {
          // Decorative: the page state carried forward. A click scrubs; the Playhead slider is the keyboard path.
          return (
            <div
              key={`rep-${slot}`}
              aria-hidden
              data-testid="filmstrip-repeat"
              onClick={() => onSeekSlot(slot)}
              className={cn("shrink-0 cursor-pointer overflow-hidden rounded-md", !active && "opacity-80 hover:opacity-100")}
              style={{ width: tileW, height: THUMB_H }}
            >
              {picture}
            </div>
          );
        }
        return (
          <button
            key={frame.id}
            type="button"
            aria-current={active ? "true" : undefined}
            aria-label={`Frame ${frameIndex + 1}, ${offset}${bad ? ", has errors" : ""}`}
            title={offset}
            data-space-plays
            onClick={() => onSelectFrame(frame)}
            className={cn(
              "group relative shrink-0 overflow-hidden rounded-md outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel",
              active ? "shadow-[0_0_0_2px_var(--color-accent-primary)]" : "opacity-80 hover:opacity-100",
            )}
            style={{ width: tileW, height: THUMB_H }}
          >
            {picture}
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
  const { n, tileW, stripW } = useMemo(() => filmstripLayout(visible, timeline.frames.length, THUMB_W, GAP), [visible, timeline]);
  // Stable for the memoized strip: the latest player callback is read through a ref.
  const seekRef = useRef(player.onSeek);
  useEffect(() => {
    seekRef.current = player.onSeek;
  }, [player.onSeek]);
  const startedAt = trace.startedAt;
  const span = timeline.span;
  const onSeekSlot = useCallback((slot: number) => seekRef.current(startedAt + ((slot + 0.5) * span) / n), [startedAt, span, n]);

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
        <div className="relative" style={{ width: stripW }}>
          <Thumbnails trace={trace} timeline={timeline} n={n} tileW={tileW} onSeekSlot={onSeekSlot} selectedFrameId={selectedFrameId} flagged={flagged} onSelectFrame={onSelectFrame} />
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
