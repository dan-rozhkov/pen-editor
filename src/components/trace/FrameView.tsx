import type { BrowseTraceFrame } from "@sideform/browser-agent/agent/session";
import { memo, useState } from "react";
import { Segmented } from "./Segmented";
import { formatOffset } from "./traceModel";

export type FrameMode = "before" | "after";

interface Props {
  mode: FrameMode;
  onModeChange(mode: FrameMode): void;
  frame: BrowseTraceFrame | undefined;
  startedAt: number;
  /** "Frame 3 of 6" counter source. */
  position: { index: number; total: number } | null;
  /** The frame is for a step; false for a trace without steps. */
  hasStep: boolean;
}

const KIND_LABEL: Record<BrowseTraceFrame["kind"], string> = { step: "After step", screenshot: "Screenshot", final: "Final state" };

const MODE_OPTIONS = [
  { value: "before", label: "before" },
  { value: "after", label: "after" },
] as const;

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <p className="max-w-80 text-pretty text-center text-xs text-text-muted">
      {title} · {hint}
    </p>
  );
}

export const FrameView = memo(function FrameView({ mode, onModeChange, frame, startedAt, position, hasStep }: Props) {
  // Remember which source failed, so a new frame gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const broken = frame !== undefined && failedSrc === frame.src;
  const ratio = frame?.width && frame.height ? frame.width / frame.height : 1.6;

  return (
    <section aria-label="Frame" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2 py-1.5">
        <Segmented label="Compare" options={MODE_OPTIONS} value={mode} onChange={onModeChange} disabled={!hasStep} itemClassName="capitalize" />
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
              key={`${mode}-${frame.id}`}
              src={frame.src}
              alt={`${KIND_LABEL[frame.kind]} at ${formatOffset(frame.at - startedAt)}`}
              onError={() => setFailedSrc(frame.src)}
              data-testid="trace-frame"
              data-frame-id={frame.id}
              style={{ width: `min(100cqw, calc(100cqh * ${ratio}))`, maxWidth: frame.width ? frame.width * 2 : undefined, aspectRatio: String(ratio) }}
              className="rounded-lg bg-white object-contain shadow-[0_1px_2px_rgb(0_0_0/0.06),0_8px_24px_-8px_rgb(0_0_0/0.18)] outline outline-1 -outline-offset-1 outline-[oklch(0_0_0/0.1)] dark:outline-[oklch(1_0_0/0.1)]"
            />
          ) : broken ? (
            <div className="text-center text-xs text-text-muted">
              <p>This frame could not be loaded · The image file may have been removed.</p>
            </div>
          ) : mode === "before" && hasStep ? (
            <Empty title="Nothing before this step" hint="No frame was captured before this step started." />
          ) : (
            <Empty title="No frame for this step" hint="Steps such as snapshot or read do not capture the page." />
          )}
        </div>
      </div>
    </section>
  );
});
