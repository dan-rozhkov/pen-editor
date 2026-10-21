import type { BrowseTraceFrame } from "@sideform/browser-agent/agent/session";
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { BAR_ROW, FRAME_SURFACE, Segmented } from "./parts";
import { formatOffset, type FrameKind, type FrameSide } from "./traceModel";

interface Props {
  frame: BrowseTraceFrame | undefined;
  startedAt: number;
  /** "Frame 3 of 6" counter source. */
  position: { index: number; total: number } | null;
  /** What `frame` is for the selected step; a filmstrip pick is its own. */
  kind?: FrameKind;
  /** Before / After switch, when the selected step has two frames to compare. */
  compare?: { view: FrameSide; onChange(view: FrameSide): void };
}

const KIND_LABEL: Record<BrowseTraceFrame["kind"], string> = { step: "After step", screenshot: "Screenshot", final: "Final state" };

function altLabel(frame: BrowseTraceFrame, kind: FrameKind): string {
  if (kind === "before") return "Before step";
  if (kind === "earlier") return "Earlier frame";
  return KIND_LABEL[frame.kind];
}

/** Natural sizes of loaded frames, cached per src so revisiting a frame does not jump. */
const measuredSizes = new Map<string, { width: number; height: number }>();

export const FrameView = memo(function FrameView({ frame, startedAt, position, kind = "own", compare }: Props) {
  // Remember which source failed, so a new frame gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const broken = frame !== undefined && failedSrc === frame.src;
  // The loaded image's own proportions win; the recorded size is only the first guess.
  const [, setMeasuredTick] = useState(0);
  const known = frame ? measuredSizes.get(frame.src) : undefined;
  const guess = frame?.width && frame.height ? frame.width / frame.height : 1.6;
  const ratio = known ? known.width / known.height : guess;
  const naturalWidth = known?.width ?? frame?.width;

  return (
    <section aria-label="Frame" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-panel">
      <div className={cn(BAR_ROW, "shrink-0")}>
        {compare && (
          <Segmented
            label="Frame view"
            value={compare.view}
            options={[
              { value: "before", label: "Before" },
              { value: "after", label: "After" },
            ]}
            onChange={compare.onChange}
          />
        )}
        {kind === "earlier" && (
          <p data-testid="frame-note" className="min-w-0 truncate ps-1 text-xs text-amber-600 dark:text-amber-400">
            Earlier frame — this step took no screenshot
          </p>
        )}
        <span className="flex-1" />
        {frame && (
          <p className="flex items-center gap-2 text-xs tabular-nums text-text-muted">
            <span data-testid="frame-offset">{formatOffset(frame.at - startedAt)}</span>
            {position && (
              <>
                <span aria-hidden className="text-text-disabled">
                  ·
                </span>
                <span>
                  Frame {position.index + 1} of {position.total}
                </span>
              </>
            )}
          </p>
        )}
      </div>
      <div className="relative min-h-[16rem] flex-1">
        <div className="absolute inset-x-4 top-0 bottom-4 flex items-center justify-center [container-type:size]">
          {frame && !broken ? (
            <img
              key={frame.id}
              src={frame.src}
              alt={`${altLabel(frame, kind)} at ${formatOffset(frame.at - startedAt)}`}
              onError={() => setFailedSrc(frame.src)}
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                if (w > 0 && h > 0 && measuredSizes.get(frame.src)?.width !== w) {
                  measuredSizes.set(frame.src, { width: w, height: h });
                  setMeasuredTick((n) => n + 1);
                }
              }}
              data-testid="trace-frame"
              data-frame-id={frame.id}
              style={{ width: `min(100cqw, calc(100cqh * ${ratio}))`, maxWidth: naturalWidth ? naturalWidth * 2 : undefined, aspectRatio: String(ratio) }}
              className={cn("rounded-lg object-contain shadow-[0_1px_2px_rgb(0_0_0/0.06),0_8px_24px_-8px_rgb(0_0_0/0.18)]", FRAME_SURFACE)}
            />
          ) : broken ? (
            <EmptyState size="panel" title="This frame could not be loaded" description="The image file may have been removed." />
          ) : (
            <EmptyState size="panel" title="No frame for this step" description="Steps such as snapshot or read do not capture the page." />
          )}
        </div>
      </div>
    </section>
  );
});
