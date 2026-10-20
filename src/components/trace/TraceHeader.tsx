import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { SquareHalfBottomIcon } from "@phosphor-icons/react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/IconButton";
import { ResultButton } from "./ResultButton";
import { RunDetails } from "./RunDetails";
import { TONE_ICON } from "./tone";
import { describeOutcome, goalFirstLine } from "./traceModel";

interface Props {
  trace: BrowseTrace;
  detailsOpen: boolean;
  onToggleDetails(): void;
}

export const TraceHeader = memo(function TraceHeader({ trace, detailsOpen, onToggleDetails }: Props) {
  const outcome = describeOutcome(trace);
  const { Icon: OutcomeIcon, className: iconClass } = TONE_ICON[outcome.tone];
  const title = goalFirstLine(trace.goal);
  return (
    <header className="shrink-0 border-b border-border-default bg-surface-panel">
      {/* Same row as the /doc header and the chat header. */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-text-primary" title={trace.goal}>
          {title}
        </h1>
        <span
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border-default bg-surface-panel px-2 text-xs font-medium whitespace-nowrap text-text-primary dark:bg-secondary/30"
          data-testid="trace-outcome"
        >
          <OutcomeIcon aria-hidden weight="fill" className={cn("size-3.5", iconClass)} />
          {outcome.label}
        </span>
        <RunDetails trace={trace} />
        <ResultButton trace={trace} />
        <IconButton
          tooltip={detailsOpen ? "Hide details" : "Show details"}
          aria-label="Details panel"
          variant="ghost"
          size="icon"
          aria-pressed={detailsOpen}
          onClick={onToggleDetails}
        >
          <SquareHalfBottomIcon className="size-4" weight="light" />
        </IconButton>
      </div>
    </header>
  );
});
