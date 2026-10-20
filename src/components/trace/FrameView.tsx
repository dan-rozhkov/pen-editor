import type { BrowseTraceFrame } from "@sideform/browser-agent/agent/session";
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { BAR_ROW, EmptyNote, FRAME_SURFACE } from "./parts";
import { formatOffset } from "./traceModel";

interface Props {
  frame: BrowseTraceFrame | undefined;
  startedAt: number;
  /** "Frame 3 of 6" counter source. */
  position: { index: number; total: number } | null;
}

const KIND_LABEL: Record<BrowseTraceFrame["kind"], string> = { step: "After step", screenshot: "Screenshot", final: "Final state" };

/** Centered, narrow layout for the frame area's notes. */
const EMPTY_CLASS = "max-w-80 text-pretty text-center";

/** Natural sizes of loaded frames, cached per src so revisiting a frame does not jump. */
const measuredSizes = new Map<string, { width: number; height: number }>();

export const FrameView = memo(function FrameView({ frame, startedAt, position }: Props) {
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
    <section aria-label="Frame" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
      <div className={cn(BAR_ROW, "shrink-0 justify-end")}>
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
              alt={`${KIND_LABEL[frame.kind]} at ${formatOffset(frame.at - startedAt)}`}
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
            <EmptyNote title="This frame could not be loaded" hint="The image file may have been removed." className={EMPTY_CLASS} />
          ) : (
            <EmptyNote title="No frame for this step" hint="Steps such as snapshot or read do not capture the page." className={EMPTY_CLASS} />
          )}
        </div>
      </div>
    </section>
  );
});
