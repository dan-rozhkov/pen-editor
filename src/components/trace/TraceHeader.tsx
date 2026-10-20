import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ResultButton } from "./ResultButton";
import { canOpenResult, resultText } from "./resultDoc";
import { TONE_BADGE } from "./tone";
import { browserLabel, describeOutcome, formatDuration, goalFirstLine, traceDuration } from "./traceModel";

export const TraceHeader = memo(function TraceHeader({ trace }: { trace: BrowseTrace }) {
  const outcome = describeOutcome(trace);
  const failedSteps = trace.steps.filter((s) => !s.ok).length;
  const browser = browserLabel(trace);
  const meta = [
    { text: formatDuration(traceDuration(trace)) },
    { text: `${trace.steps.length} ${trace.steps.length === 1 ? "step" : "steps"}` },
    ...(failedSteps > 0 ? [{ text: `${failedSteps} failed`, danger: true }] : []),
    ...(browser ? [{ text: browser }] : []),
    { text: new Date(trace.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) },
  ] as { text: string; danger?: boolean }[];
  const title = goalFirstLine(trace.goal);
  // Without a way to open the result as a document, show it here.
  const inlineResult = canOpenResult() ? "" : resultText(trace);
  return (
    <header className="shrink-0 border-b border-border-default bg-surface-panel">
      {/* Same row as the /doc header and the chat header. */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-text-primary" title={trace.goal}>
          {title}
        </h1>
        <Badge className={cn("h-5 shrink-0 px-2 text-[11px]", TONE_BADGE[outcome.tone])} data-testid="trace-outcome">
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {outcome.label}
        </Badge>
        <ResultButton trace={trace} />
      </div>
      <p className="px-3 pb-2 text-xs tabular-nums text-text-muted">
        {meta.map((part, i) => (
          <span key={part.text}>
            {i > 0 && (
              <span aria-hidden className="px-1.5 text-text-disabled">
                ·
              </span>
            )}
            <span className={part.danger ? "text-destructive" : undefined}>{part.text}</span>
          </span>
        ))}
      </p>
      {trace.error && (
        <p className="truncate px-3 pb-2 text-xs text-destructive" title={trace.error}>
          <span className="font-medium">Error: </span>
          {trace.error}
        </p>
      )}
      {inlineResult && (
        <p className="line-clamp-1 px-3 pb-2 text-xs text-text-secondary" title={inlineResult}>
          <span className="font-medium">Result: </span>
          {inlineResult}
        </p>
      )}
    </header>
  );
});
