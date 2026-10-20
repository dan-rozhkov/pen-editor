import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { SquareHalfBottomIcon } from "@phosphor-icons/react";
import { memo } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { ResultButton } from "./ResultButton";
import { RunDetails } from "./RunDetails";
import { BAR_ROW, OutcomeBadge } from "./parts";
import { describeOutcome, goalFirstLine } from "./traceModel";

interface Props {
  trace: BrowseTrace;
  detailsOpen: boolean;
  onToggleDetails(): void;
}

export const TraceHeader = memo(function TraceHeader({ trace, detailsOpen, onToggleDetails }: Props) {
  const outcome = describeOutcome(trace);
  const title = goalFirstLine(trace.goal);
  return (
    <header className="shrink-0 border-b border-border-default bg-surface-panel">
      {/* Same row as the /doc header and the chat header. */}
      <div className={BAR_ROW}>
        <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-text-primary" title={trace.goal}>
          {title}
        </h1>
        <OutcomeBadge tone={outcome.tone} label={outcome.label} data-testid="trace-outcome" />
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
