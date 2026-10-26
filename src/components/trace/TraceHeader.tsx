import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { SquareHalfBottomIcon } from "@/components/icons";
import { memo, type ReactNode } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { RunDetails } from "./RunDetails";
import { TraceActionsMenu } from "./TraceActionsMenu";
import { BAR_ROW, OutcomeBadge } from "./parts";
import { describeOutcome, goalFirstLine } from "./traceModel";

interface Props {
  trace: BrowseTrace;
  cloudTraceId?: string;
  detailsOpen: boolean;
  onToggleDetails(): void;
  /** Trace switcher, first in the toolbar row. */
  switcher?: ReactNode;
}

export const TraceHeader = memo(function TraceHeader({ trace, cloudTraceId, detailsOpen, onToggleDetails, switcher }: Props) {
  const outcome = describeOutcome(trace);
  const title = goalFirstLine(trace.goal);
  return (
    <header className="shrink-0 border-b border-border-default bg-surface-panel">
      {/* Toolbar row of the trace viewer; the 16px gutter lines up with the filmstrip, steps and details panel. */}
      <div className={BAR_ROW}>
        {switcher}
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary" title={trace.goal}>
          {title}
        </h1>
        <OutcomeBadge tone={outcome.tone} label={outcome.label} data-testid="trace-outcome" />
        <RunDetails trace={trace} />
        <TraceActionsMenu trace={trace} cloudTraceId={cloudTraceId} />
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
