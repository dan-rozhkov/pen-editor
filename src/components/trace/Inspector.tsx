import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import type { BrowseTrace, BrowseTraceLogEntry } from "@sideform/browser-agent/agent/session";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { TONE_BADGE } from "./tone";
import {
  describeCheck,
  describeOutcome,
  formatOffset,
  parseNetworkEntry,
} from "./traceModel";

function Empty({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
      <span className="text-text-disabled [&>svg]:size-7">{icon}</span>
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      {hint && <p className="max-w-60 text-pretty text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

interface LogProps {
  trace: BrowseTrace;
  entries: BrowseTraceLogEntry[];
  droppedCount: number | undefined;
  selectedStep: number | null;
  kind: "console" | "network";
  onSelectStep(index: number): void;
}

function LogPanel({ trace, entries, droppedCount, selectedStep, kind, onSelectStep }: LogProps) {
  if (entries.length === 0) {
    return kind === "console" ? (
      <Empty icon={<CheckCircleIcon weight="light" />} title="No console errors" hint="The page logged nothing at error level during this run." />
    ) : (
      <Empty icon={<CheckCircleIcon weight="light" />} title="No failed requests" hint="Every request the page made succeeded." />
    );
  }
  return (
    <>
      <ul className="-mx-1 space-y-0.5">
        {entries.map((entry, i) => {
          const net = kind === "network" ? parseNetworkEntry(entry.text) : null;
          const linked = entry.stepIndex !== undefined;
          const current = linked && entry.stepIndex === selectedStep;
          return (
            <li key={`${entry.at}-${i}`}>
              <button
                type="button"
                disabled={!linked}
                onClick={() => entry.stepIndex !== undefined && onSelectStep(entry.stepIndex)}
                className={cn(
                  "grid w-full grid-cols-[3.5rem_minmax(0,1fr)] gap-2 rounded-md px-1 py-1.5 text-start outline-none",
                  "focus-visible:ring-2 focus-visible:ring-accent-primary/60 enabled:hover:bg-secondary dark:enabled:hover:bg-secondary/50",
                  current && "bg-accent-selection",
                )}
              >
                <span className="pt-px text-[11px] tabular-nums text-text-muted">{formatOffset(entry.at - trace.startedAt)}</span>
                <span className="min-w-0 space-y-0.5">
                  {net ? (
                    <span className="flex items-baseline gap-1.5 font-mono text-[11px]/relaxed">
                      <span className="font-semibold text-text-secondary">{net.method}</span>
                      <span className={cn("font-semibold tabular-nums", net.failed ? "text-destructive" : "text-text-secondary")}>{net.status}</span>
                      <span className="min-w-0 break-all text-text-muted">{net.url}</span>
                    </span>
                  ) : (
                    <span className="block font-mono text-[11px]/relaxed break-words whitespace-pre-wrap text-text-secondary">{entry.text}</span>
                  )}
                  {linked && <span className="block text-[11px] text-text-muted">Step {entry.stepIndex! + 1}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {droppedCount ? <p className="mt-3 text-xs text-text-muted">{droppedCount} more not recorded.</p> : null}
    </>
  );
}

function QaPanel({ trace }: { trace: BrowseTrace }) {
  const qa = trace.qa;
  if (!qa) return <Empty icon={<CheckCircleIcon weight="light" />} title="Not a QA run" hint="QA verdicts, checks and the judge appear here for runs started in QA mode." />;
  const outcome = describeOutcome(trace);
  const judge = qa.judge;
  return (
    <div className="space-y-5">
      <section className="space-y-1.5">
        <Badge className={cn("h-6 px-2.5 text-xs", TONE_BADGE[outcome.tone])}>{outcome.label}</Badge>
        {qa.reason ? <p className="text-pretty text-sm text-text-primary">{qa.reason}</p> : <p className="text-xs text-text-muted">The agent gave no reason.</p>}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-text-muted">
          Checks <span className="tabular-nums">{qa.checks?.length ?? 0}</span>
        </h3>
        {qa.checks && qa.checks.length > 0 ? (
          <ul className="space-y-1.5">
            {qa.checks.map((check, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-surface-elevated px-3 py-2">
                {check.passed ? (
                  <CheckCircleIcon weight="fill" aria-label="Passed" className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <XCircleIcon weight="fill" aria-label="Failed" className="mt-0.5 size-4 shrink-0 text-destructive" />
                )}
                <div className="min-w-0 text-xs/relaxed">
                  <p className="font-medium break-words text-text-primary">{describeCheck(check.check)}</p>
                  {(check.actual || check.error) && <p className="break-words text-text-muted">{check.error ?? check.actual}</p>}
                  <p className="text-[11px] text-text-disabled">{check.source === "final" ? "Final check" : "Agent check"}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-text-muted">No checks ran.</p>
        )}
      </section>

      {judge && (
        <section className="space-y-1.5">
          <h3 className="text-xs font-medium text-text-muted">Judge</h3>
          {"error" in judge ? (
            <p className="rounded-lg bg-destructive/8 px-3 py-2 text-xs/relaxed break-words text-destructive">The judge did not finish: {judge.error}</p>
          ) : (
            <div className="space-y-1.5 rounded-lg bg-surface-elevated px-3 py-2">
              <Badge className={cn("h-5", TONE_BADGE[judge.verdict === "pass" ? "success" : judge.verdict === "fail" ? "danger" : "warning"])}>{judge.verdict}</Badge>
              <p className="text-pretty text-xs/relaxed text-text-secondary">{judge.reason}</p>
            </div>
          )}
        </section>
      )}
      {qa.stepsDropped ? <p className="text-xs text-text-muted">{qa.stepsDropped} earlier QA steps are not listed.</p> : null}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="tabular-nums text-text-muted">{n}</span>;
}

interface Props {
  trace: BrowseTrace;
  selectedStep: number | null;
  onSelectStep(index: number): void;
}

export function Inspector({ trace, selectedStep, onSelectStep }: Props) {
  const failedChecks = trace.qa?.checks?.filter((c) => !c.passed).length ?? 0;
  return (
    <Tabs defaultValue="console" className="min-h-0 flex-1 gap-0 bg-surface-panel">
      <div className="shrink-0 px-3 pt-3 pb-2">
        <TabsList aria-label="Details">
          <TabsTrigger value="console">
            Console <Count n={trace.console.length} />
          </TabsTrigger>
          <TabsTrigger value="network">
            Network <Count n={trace.network.length} />
          </TabsTrigger>
          <TabsTrigger value="qa">
            QA {failedChecks > 0 && <Count n={failedChecks} />}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="console" className="min-h-0 overflow-y-auto px-3 pt-1 pb-4">
        <LogPanel trace={trace} entries={trace.console} droppedCount={trace.dropped?.console} selectedStep={selectedStep} kind="console" onSelectStep={onSelectStep} />
      </TabsContent>
      <TabsContent value="network" className="min-h-0 overflow-y-auto px-3 pt-1 pb-4">
        <LogPanel trace={trace} entries={trace.network} droppedCount={trace.dropped?.network} selectedStep={selectedStep} kind="network" onSelectStep={onSelectStep} />
      </TabsContent>
      <TabsContent value="qa" className="min-h-0 overflow-y-auto px-4 pt-2 pb-4">
        <QaPanel trace={trace} />
      </TabsContent>
    </Tabs>
  );
}
