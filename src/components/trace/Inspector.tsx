import { CheckCircleIcon, CheckIcon, CopyIcon, XCircleIcon } from "@phosphor-icons/react";
import type { BrowseTrace, BrowseTraceLogEntry, BrowseTraceStep } from "@sideform/browser-agent/agent/session";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/IconButton";
import { IconSwap } from "@/components/ui/IconSwap";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { TONE_BADGE } from "./tone";
import {
  describeCheck,
  describeOutcome,
  formatDuration,
  formatOffset,
  parseNetworkEntry,
  prettyJson,
  prettyText,
  stepDuration,
  toolLabel,
} from "./traceModel";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      } catch {
        // Clipboard may be blocked; the text stays selectable.
      }
    })();
  };
  return (
    <IconButton type="button" variant="ghost" size="icon-xs" tooltip={copied ? "Copied" : label} aria-label={label} onClick={copy} static>
      <IconSwap active={copied} activeIcon={<CheckIcon className="size-3.5" />} inactiveIcon={<CopyIcon weight="light" className="size-3.5" />} />
    </IconButton>
  );
}

function Block({ title, text, tone }: { title: string; text: string; tone?: "danger" }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className={cn("text-xs font-medium", tone === "danger" ? "text-destructive" : "text-text-muted")}>{title}</h3>
        <CopyButton text={text} label={`Copy ${title.toLowerCase()}`} />
      </div>
      <pre
        className={cn(
          "max-h-64 overflow-auto rounded-lg p-3 font-mono text-[11px]/relaxed break-words whitespace-pre-wrap",
          tone === "danger" ? "bg-destructive/8 text-destructive" : "bg-surface-elevated text-text-secondary",
        )}
      >
        {text}
      </pre>
    </section>
  );
}

function Empty({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
      <span className="text-text-disabled [&>svg]:size-7">{icon}</span>
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      {hint && <p className="max-w-60 text-pretty text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

function StepPanel({ trace, step }: { trace: BrowseTrace; step: BrowseTraceStep | undefined }) {
  if (!step) return <Empty icon={<CheckCircleIcon weight="light" />} title="No step selected" hint="Pick a step in the list to see its input and output." />;
  const args = prettyJson(step.args);
  const output = prettyText(step.output);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">{toolLabel(step.tool)}</h2>
          <Badge className={cn("h-5", step.ok ? TONE_BADGE.success : TONE_BADGE.danger)}>{step.ok ? "Succeeded" : "Failed"}</Badge>
        </div>
        <p className="mt-1 text-xs tabular-nums text-text-muted">
          {formatOffset(step.startedAt - trace.startedAt)} to {formatOffset(step.endedAt - trace.startedAt)} · {formatDuration(stepDuration(step))}
        </p>
      </div>
      {step.error && <Block title="Error" text={step.error} tone="danger" />}
      {args && args !== "{}" ? <Block title="Arguments" text={args} /> : <p className="text-xs text-text-muted">This step took no arguments.</p>}
      {output ? <Block title="Output" text={output} /> : <p className="text-xs text-text-muted">This step returned no output.</p>}
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
                  "grid w-full grid-cols-[3.5rem_minmax(0,1fr)] gap-2 rounded-md px-1 py-1.5 text-start outline-none transition-colors duration-150 motion-reduce:transition-none",
                  "focus-visible:ring-2 focus-visible:ring-accent-primary/60 enabled:hover:bg-surface-hover/60",
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
  step: BrowseTraceStep | undefined;
  selectedStep: number | null;
  onSelectStep(index: number): void;
}

export function Inspector({ trace, step, selectedStep, onSelectStep }: Props) {
  const failedChecks = trace.qa?.checks?.filter((c) => !c.passed).length ?? 0;
  return (
    <Tabs defaultValue="step" className="min-h-0 flex-1 gap-0 bg-surface-panel">
      <div className="shrink-0 px-3 pt-3 pb-2">
        <TabsList className="w-full" aria-label="Details">
          <TabsTrigger value="step">Step</TabsTrigger>
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
      <TabsContent value="step" className="min-h-0 overflow-y-auto px-4 pt-2 pb-4">
        <StepPanel trace={trace} step={step} />
      </TabsContent>
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
