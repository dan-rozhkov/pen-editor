import { CalendarBlankIcon, ClockIcon, GlobeIcon, ListNumbersIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TONE_BADGE } from "./tone";
import { browserLabel, describeOutcome, formatDuration, traceDuration } from "./traceModel";

function Meta({ icon, children, tone }: { icon: ReactNode; children: ReactNode; tone?: "danger" }) {
  return (
    <li className={cn("flex items-center gap-1.5 text-xs tabular-nums", tone === "danger" ? "text-destructive" : "text-text-muted")}>
      <span className="shrink-0 [&>svg]:size-3.5">{icon}</span>
      {children}
    </li>
  );
}

export function TraceHeader({ trace }: { trace: BrowseTrace }) {
  const outcome = describeOutcome(trace);
  const failedSteps = trace.steps.filter((s) => !s.ok).length;
  const browser = browserLabel(trace);
  const result = trace.error ?? trace.answer;
  return (
    <header className="shrink-0 border-b border-border-default bg-surface-panel px-4 py-3">
      <div className="flex items-start gap-3">
        <h1 className="min-w-0 flex-1 text-balance text-base/snug font-semibold text-text-primary line-clamp-2" title={trace.goal}>
          {trace.goal || "Untitled run"}
        </h1>
        <Badge className={cn("mt-0.5 h-6 px-2.5 text-xs", TONE_BADGE[outcome.tone])} data-testid="trace-outcome">
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {outcome.label}
        </Badge>
      </div>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Meta icon={<ClockIcon weight="light" />}>{formatDuration(traceDuration(trace))}</Meta>
        <Meta icon={<ListNumbersIcon weight="light" />}>
          {trace.steps.length} {trace.steps.length === 1 ? "step" : "steps"}
        </Meta>
        {failedSteps > 0 && (
          <Meta icon={<WarningCircleIcon weight="light" />} tone="danger">
            {failedSteps} failed
          </Meta>
        )}
        {browser && <Meta icon={<GlobeIcon weight="light" />}>{browser}</Meta>}
        <Meta icon={<CalendarBlankIcon weight="light" />}>
          {new Date(trace.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </Meta>
      </ul>
      {result && (
        <p className={cn("mt-2 line-clamp-1 text-xs", trace.error ? "text-destructive" : "text-text-secondary")} title={result}>
          <span className="font-medium">{trace.error ? "Error: " : "Result: "}</span>
          {result}
        </p>
      )}
    </header>
  );
}
