import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { formatDuration, type StepRow } from "./traceModel";

interface Props {
  rows: StepRow[];
  selected: number | null;
  /** Step indexes with a failure or a console/network entry. */
  flagged: Set<number>;
  onSelect(index: number): void;
}

export function StepList({ rows, selected, flagged, onSelect }: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // Keyboard navigation moves the selection; keep the row in view.
    listRef.current?.querySelector<HTMLElement>('[aria-current="step"]')?.scrollIntoView?.({ block: "nearest" });
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
                  aria-current={active ? "step" : undefined}
                  onClick={() => onSelect(step.index)}
                  className={cn(
                    "group relative grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-lg px-2 py-2 text-start outline-none",
                    "transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent-primary/60",
                    active ? "bg-accent-selection" : "hover:bg-surface-hover/60",
                  )}
                >
                  <span className="text-end text-[11px] tabular-nums text-text-muted">{step.index + 1}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-text-primary">{label}</span>
                      {flagged.has(step.index) && step.ok && (
                        <span title="Console or network problems" className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                      )}
                    </span>
                    {summary && <span className="block truncate text-xs text-text-muted">{summary}</span>}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs tabular-nums text-text-secondary">
                    {formatDuration(durationMs)}
                    {step.ok ? (
                      <CheckCircleIcon weight="fill" className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-label="Succeeded" />
                    ) : (
                      <XCircleIcon weight="fill" className="size-3.5 text-destructive" aria-label="Failed" />
                    )}
                  </span>
                  <span aria-hidden className="col-start-2 col-end-4 h-[3px] overflow-hidden rounded-full bg-surface-elevated">
                    <span
                      className={cn("block h-full origin-left rounded-full", step.ok ? "bg-accent-primary/50" : "bg-destructive/70")}
                      style={{ width: `${Math.max(2, ratio * 100)}%` }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
