import { XCircleIcon } from "@phosphor-icons/react";
import { memo, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { keepInView } from "./keepInView";
import { formatDuration, type StepRow } from "./traceModel";

interface Props {
  rows: StepRow[];
  selected: number | null;
  /** Step indexes with a failure or a console/network entry. */
  flagged: Set<number>;
  onSelect(index: number): void;
}

export const StepList = memo(function StepList({ rows, selected, flagged, onSelect }: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // Keyboard navigation moves the selection; keep the row in view.
    keepInView(listRef.current?.querySelector<HTMLElement>('[aria-current="step"]'));
  }, [selected]);

  return (
    <section aria-label="Steps" className="flex min-h-0 flex-1 flex-col bg-surface-panel">
      <h2 className="flex shrink-0 items-baseline justify-between px-4 pt-3 pb-2 text-xs font-medium text-text-muted">
        Steps
        <span className="tabular-nums">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-text-muted">No steps were recorded.</p>
      ) : (
        <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {rows.map(({ step, label, summary, durationMs, ratio }) => {
            const active = step.index === selected;
            return (
              <li key={step.index}>
                <button
                  type="button"
                  data-space-plays
                  aria-current={active ? "step" : undefined}
                  onClick={() => onSelect(step.index)}
                  className={cn(
                    "group relative grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-start outline-none",
                    "focus-visible:ring-2 focus-visible:ring-accent-primary/60",
                    active ? "bg-accent-selection" : "hover:bg-secondary dark:hover:bg-secondary/50",
                  )}
                >
                  <span className="text-end text-[11px] leading-[18px] tabular-nums text-text-muted">{step.index + 1}</span>
                  <span className="min-w-0">
                    <span className="flex h-[18px] items-center gap-1.5">
                      <span className="truncate text-[13px] leading-[18px] font-medium text-text-primary">{label}</span>
                      {flagged.has(step.index) && step.ok && (
                        <span title="Console or network problems" className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                      )}
                    </span>
                    {summary && <span className="block truncate text-xs text-text-muted">{summary}</span>}
                    <span aria-hidden className="mt-1 block h-0.5 overflow-hidden rounded-full bg-surface-elevated">
                      <span
                        className={cn("block h-full origin-left rounded-full", step.ok ? "bg-accent-primary" : "bg-destructive")}
                        style={{ width: `${Math.max(2, ratio * 100)}%` }}
                      />
                    </span>
                  </span>
                  <span className="flex h-[18px] items-center gap-1.5 text-xs leading-[18px] tabular-nums text-text-secondary">
                    {formatDuration(durationMs)}
                    {!step.ok && <XCircleIcon weight="fill" className="size-3.5 text-destructive" aria-label="Failed" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
});
