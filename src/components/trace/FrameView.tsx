import { CameraIcon, FlagIcon, ImageBrokenIcon, ImageIcon } from "@phosphor-icons/react";
import type { BrowseTraceFrame } from "@sideform/browser-agent/agent/session";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

function Segmented({ mode, onModeChange, disabled }: Pick<Props, "mode" | "onModeChange"> & { disabled: boolean }) {
  return (
    <div role="group" aria-label="Compare" className="inline-flex rounded-lg bg-secondary p-[3px]">
      {(["before", "after"] as const).map((value) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant="ghost"
          static
          disabled={disabled}
          aria-pressed={mode === value}
          onClick={() => onModeChange(value)}
          className={cn("h-6 rounded-md px-3 capitalize", mode === value && "bg-background text-foreground shadow-xs hover:bg-background dark:bg-surface-elevated")}
        >
          {value}
        </Button>
      ))}
    </div>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <ImageIcon weight="light" className="size-8 text-text-disabled" />
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      <p className="max-w-64 text-pretty text-xs text-text-muted">{hint}</p>
    </div>
  );
}

export function FrameView({ mode, onModeChange, frame, startedAt, position, hasStep }: Props) {
  // Remember which source failed, so a new frame gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const broken = frame !== undefined && failedSrc === frame.src;
  const ratio = frame?.width && frame.height ? frame.width / frame.height : 1.6;
  const KindIcon = frame?.kind === "final" ? FlagIcon : frame?.kind === "screenshot" ? CameraIcon : null;

  return (
    <section aria-label="Frame" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
        <Segmented mode={mode} onModeChange={onModeChange} disabled={!hasStep} />
        {frame && (
          <p className="flex items-center gap-2 text-xs tabular-nums text-text-muted">
            <span className="flex items-center gap-1 font-medium text-text-secondary">
              {KindIcon && <KindIcon weight="light" className="size-3.5" />}
              {mode === "before" && hasStep ? "Before step" : KIND_LABEL[frame.kind]}
            </span>
            <span aria-hidden>·</span>
            <span data-testid="frame-offset">{formatOffset(frame.at - startedAt)}</span>
            {frame.width && frame.height && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {frame.width} × {frame.height}
                </span>
              </>
            )}
            {position && (
              <>
                <span aria-hidden>·</span>
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
              className="trace-frame-in rounded-lg bg-white object-contain shadow-[0_1px_2px_rgb(0_0_0/0.06),0_8px_24px_-8px_rgb(0_0_0/0.18)] outline outline-1 -outline-offset-1 outline-[oklch(0_0_0/0.1)] dark:outline-[oklch(1_0_0/0.1)]"
            />
          ) : broken ? (
            <div className="flex flex-col items-center gap-1.5 text-center">
              <ImageBrokenIcon weight="light" className="size-8 text-text-disabled" />
              <p className="text-sm font-medium text-text-secondary">This frame could not be loaded</p>
              <p className="text-xs text-text-muted">The image file may have been removed.</p>
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
}
