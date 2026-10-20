import { InfoIcon } from "@phosphor-icons/react";
import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { canOpenResult, resultText } from "./resultDoc";
import { browserLabel, formatDuration, traceDuration } from "./traceModel";

/** "Run details": duration, steps, failures, browser and start time, plus the error and (when it cannot open as a document) the result. */
export const RunDetails = memo(function RunDetails({ trace }: { trace: BrowseTrace }) {
  const failedSteps = trace.steps.filter((s) => !s.ok).length;
  const browser = browserLabel(trace);
  // Without a way to open the result as a document, show it here.
  const inlineResult = canOpenResult() ? "" : resultText(trace);
  const problems = failedSteps > 0 || !!trace.error;
  const rows: { term: string; value: string; danger?: boolean }[] = [
    { term: "Duration", value: formatDuration(traceDuration(trace)) },
    { term: "Steps", value: String(trace.steps.length) },
    ...(failedSteps > 0 ? [{ term: "Failed", value: String(failedSteps), danger: true }] : []),
    ...(browser ? [{ term: "Browser", value: browser }] : []),
    { term: "Started", value: new Date(trace.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) },
  ];
  return (
    <Popover>
      <PopoverTrigger
        render={
          // No tooltip: it would pop up again when focus returns to the trigger after the popover closes.
          <Button type="button" variant="ghost" size="icon" aria-label={problems ? "Run details, has errors" : "Run details"} className="relative">
            <InfoIcon className="size-4" weight="light" />
            {problems && <span aria-hidden data-testid="run-details-dot" className="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-destructive ring-2 ring-surface-panel" />}
          </Button>
        }
      />
      <PopoverContent align="end" side="bottom" className="w-80 max-w-[calc(100vw-1rem)] gap-3 p-3 text-xs">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 tabular-nums">
          {rows.map(({ term, value, danger }) => (
            <div key={term} className="contents">
              <dt className="text-text-muted">{term}</dt>
              <dd className={danger ? "text-destructive" : "text-text-primary"}>{value}</dd>
            </div>
          ))}
        </dl>
        {trace.error && (
          <p className="break-words text-destructive">
            <span className="font-medium">Error: </span>
            {trace.error}
          </p>
        )}
        {inlineResult && (
          <p className="break-words text-text-secondary">
            <span className="font-medium">Result: </span>
            {inlineResult}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
});
