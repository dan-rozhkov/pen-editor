import { memo, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { keepInView } from "./keepInView";
import { EmptyNote, RowButton, SectionHeading, StatusDot, ToneIcon } from "./parts";
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
      <SectionHeading as="h2" count={rows.length} className="flex shrink-0 items-baseline justify-between px-4 pt-3 pb-2">
        Steps
      </SectionHeading>
      {rows.length === 0 ? (
        <EmptyNote title="No steps were recorded." className="px-4 py-6" />
      ) : (
        <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {rows.map(({ step, label, summary, durationMs, ratio }) => {
            const active = step.index === selected;
            return (
              <li key={step.index}>
                <RowButton
                  active={active}
                  onClick={() => onSelect(step.index)}
                  className="group relative grid grid-cols-[minmax(1.5rem,auto)_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1 px-2 py-1.5"
                >
                  <span className="text-end text-[13px] leading-[18px] tabular-nums text-text-muted">{step.index + 1}</span>
                  <span className="min-w-0">
                    <span data-testid="step-title" className="flex h-[18px] items-center gap-1.5">
                      <span className="truncate text-[13px] leading-[18px] font-medium text-text-primary">{label}</span>
                      {flagged.has(step.index) && step.ok && (
                        <StatusDot tone="warning" title="Console or network problems" className="size-1.5 shrink-0" />
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
                  <span className="flex h-[18px] items-center gap-1.5 text-[13px] leading-[18px] tabular-nums text-text-secondary">
                    {formatDuration(durationMs)}
                    {!step.ok && <ToneIcon tone="danger" label="Failed" className="size-3.5" />}
                  </span>
                </RowButton>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
});
