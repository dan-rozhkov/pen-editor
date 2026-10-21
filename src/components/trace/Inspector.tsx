import type { BrowseTrace, BrowseTraceLogEntry, BrowseTraceRequest } from "@sideform/browser-agent/agent/session";
import { LinkSimpleIcon } from "@phosphor-icons/react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { keepInView } from "./keepInView";
import { EmptyState } from "@/components/ui/empty-state";
import { CopyButton } from "./CopyButton";
import { useCopy } from "./useCopy";
import { BAR_ROW, Count, EmptyNote, OutcomeBadge, RowButton, SectionHeading, Segmented, ToneIcon } from "./parts";
import {
  NO_LOG_FILTER,
  batchProgress,
  describeCheck,
  describeOutcome,
  droppedRequests,
  filterLogEntries,
  filteredCount,
  formatBytes,
  formatDuration,
  formatOffset,
  parseNetworkEntry,
  prettyJson,
  prettyText,
  requestFailed,
  requestText,
  requestWaterfall,
  shortUrl,
  stepActions,
  stepDuration,
  stepLinkUrl,
  toolLabel,
  traceRequests,
  type LogFilter,
} from "./traceModel";

function Empty({ title, hint }: { title: string; hint?: string }) {
  return <EmptyState size="panel" title={title} description={hint} className="mx-auto px-1 py-4" />;
}

/** Scope switch and text search above a log; `shown` of `total` entries. */
function LogToolbar({
  kind,
  filter,
  onChange,
  canScope,
  shown,
  total,
  children,
}: {
  kind: string;
  filter: LogFilter;
  onChange(filter: LogFilter): void;
  /** A step is selected, so "This step" means something. */
  canScope: boolean;
  shown: number;
  total: number;
  children?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-2 mb-1 flex flex-wrap items-center gap-2 bg-surface-panel px-2 py-1.5">
      <Segmented
        label={`${kind} scope`}
        value={filter.scope}
        disabled={!canScope}
        options={[
          { value: "all", label: "All" },
          { value: "step", label: "This step" },
        ]}
        onChange={(scope) => onChange({ ...filter, scope })}
      />
      {children}
      <Input
        type="search"
        aria-label={`Filter ${kind}`}
        placeholder="Filter"
        value={filter.query}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
        className="w-40 min-w-0 flex-1 sm:flex-none"
      />
      <span data-testid={`${kind}-count`} className="ms-auto text-[11px] tabular-nums text-text-muted">
        {filteredCount(shown, total)}
      </span>
    </div>
  );
}

interface LogProps {
  trace: BrowseTrace;
  entries: BrowseTraceLogEntry[];
  droppedCount: number | undefined;
  selectedStep: number | null;
  kind: "console" | "network";
  filter: LogFilter;
  onFilter(filter: LogFilter): void;
  onSelectStep(index: number): void;
}

const stepOf = (trace: BrowseTrace, index: number | null) => trace.steps.find((s) => s.index === index);

function LogPanel({ trace, entries: all, droppedCount, selectedStep, kind, filter, onFilter, onSelectStep }: LogProps) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    // Playback moves the selected step; keep its first entry in view.
    keepInView(listRef.current?.querySelector<HTMLElement>('[aria-current="step"]'));
  }, [selectedStep]);
  const entries = filterLogEntries(all, filter, stepOf(trace, selectedStep), (e) => e.text);
  if (all.length === 0) {
    return kind === "console" ? (
      <Empty title="No console errors" hint="The page logged nothing at error level during this run." />
    ) : (
      <Empty title="No failed requests" hint="Every request the page made succeeded." />
    );
  }
  return (
    <>
      <LogToolbar kind={kind === "network" ? "requests" : kind} filter={filter} onChange={onFilter} canScope={selectedStep !== null} shown={entries.length} total={all.length} />
      {entries.length === 0 && <Empty title="Nothing matches" hint="Change the filter to see more." />}
      <ul ref={listRef} className="-mx-1 space-y-0.5">
        {entries.map((entry, i) => {
          const net = kind === "network" ? parseNetworkEntry(entry.text) : null;
          const linked = entry.stepIndex !== undefined;
          const current = linked && entry.stepIndex === selectedStep;
          return (
            <li key={`${entry.at}-${i}`}>
              <RowButton
                active={current}
                disabled={!linked}
                onClick={() => entry.stepIndex !== undefined && onSelectStep(entry.stepIndex)}
                className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 px-1 py-1.5"
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
              </RowButton>
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
  if (!qa) return <Empty title="Not a QA run" hint="QA verdicts, checks and the judge appear here for runs started in QA mode." />;
  const outcome = describeOutcome(trace);
  const judge = qa.judge;
  return (
    <div className="space-y-5">
      <section className="space-y-1.5">
        <OutcomeBadge tone={outcome.tone} label={outcome.label} />
        {qa.reason ? <p className="text-pretty text-sm text-text-primary">{qa.reason}</p> : <EmptyNote title="The agent gave no reason." />}
      </section>

      <section className="space-y-2">
        <SectionHeading count={qa.checks?.length ?? 0}>Checks</SectionHeading>
        {qa.checks && qa.checks.length > 0 ? (
          <ul className="space-y-1.5">
            {qa.checks.map((check, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-surface-elevated px-3 py-2">
                <ToneIcon tone={check.passed ? "success" : "danger"} label={check.passed ? "Passed" : "Failed"} className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 text-xs/relaxed">
                  <p className="font-medium break-words text-text-primary">{describeCheck(check.check)}</p>
                  {(check.actual || check.error) && <p className="break-words text-text-muted">{check.error ?? check.actual}</p>}
                  <p className="text-[11px] text-text-disabled">{check.source === "final" ? "Final check" : "Agent check"}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote title="No checks ran." />
        )}
      </section>

      {judge && (
        <section className="space-y-1.5">
          <SectionHeading>Judge</SectionHeading>
          {"error" in judge ? (
            <p className="rounded-lg bg-destructive/8 px-3 py-2 text-xs/relaxed break-words text-destructive">The judge did not finish: {judge.error}</p>
          ) : (
            <div className="space-y-1.5 rounded-lg bg-surface-elevated px-3 py-2">
              <OutcomeBadge size="sm" tone={judge.verdict === "pass" ? "success" : judge.verdict === "fail" ? "danger" : "warning"} label={judge.verdict} />
              <p className="text-pretty text-xs/relaxed text-text-secondary">{judge.reason}</p>
            </div>
          )}
        </section>
      )}
      {qa.stepsDropped ? <p className="text-xs text-text-muted">{qa.stepsDropped} earlier QA steps are not listed.</p> : null}
    </div>
  );
}

function Block({ title, text, copyLabel, empty }: { title: string; text: string; copyLabel: string; empty: string }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between">
        <SectionHeading>{title}</SectionHeading>
        {text && <CopyButton text={text} label={copyLabel} />}
      </div>
      {text ? (
        <pre className="max-h-48 overflow-auto rounded-lg bg-surface-elevated p-2 font-mono text-[11px]/relaxed break-words whitespace-pre-wrap text-text-secondary">{text}</pre>
      ) : (
        <EmptyNote title={empty} />
      )}
    </section>
  );
}

function StepPanel({ trace, selectedStep, canLink }: { trace: BrowseTrace; selectedStep: number | null; canLink: boolean }) {
  const [linkCopied, copy] = useCopy();
  const step = stepOf(trace, selectedStep);
  if (!step) return <Empty title="No step selected" hint="Pick a step to see its arguments, output and errors." />;
  const actions = stepActions(step);
  const batch = batchProgress(step);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="text-sm font-medium text-text-primary">
          <span className="tabular-nums text-text-muted">{step.index + 1}</span> {toolLabel(step.tool)}
        </h3>
        <OutcomeBadge size="sm" tone={step.ok ? "success" : "danger"} label={step.ok ? "OK" : "Failed"} />
        <span className="text-xs tabular-nums text-text-muted">{formatDuration(stepDuration(step))}</span>
        <span className="text-xs tabular-nums text-text-muted">Starts {formatOffset(step.startedAt - trace.startedAt)}</span>
        {canLink && (
          <Button variant="ghost" size="sm" className="ms-auto" onClick={() => copy(stepLinkUrl(window.location, step.index))}>
            <LinkSimpleIcon weight="light" />
            {linkCopied ? "Link copied" : "Copy link to this step"}
          </Button>
        )}
      </div>

      {!step.ok && step.error && (
        <p role="alert" className="rounded-lg bg-destructive/8 px-3 py-2 text-xs/relaxed break-words whitespace-pre-wrap text-destructive">
          {step.error}
        </p>
      )}

      {actions && (
        <section className="space-y-1.5">
          <SectionHeading count={actions.length}>Actions</SectionHeading>
          <ol className="space-y-1">
            {actions.map((action, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-surface-elevated px-3 py-1.5 text-xs/relaxed">
                <ToneIcon tone={action.ok ? "success" : "danger"} label={action.ok ? "Passed" : "Failed"} className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0">
                  <span className="font-medium break-words text-text-primary">{action.action}</span>
                  {action.error && <span className="block break-words text-destructive">{action.error}</span>}
                </span>
              </li>
            ))}
          </ol>
          {batch && batch.notRun > 0 && <p className="text-xs text-text-muted">{batch.notRun} not run</p>}
        </section>
      )}

      <Block title="Arguments" text={prettyJson(step.args)} copyLabel="Copy arguments" empty="No arguments." />
      <Block title="Output" text={prettyText(step.output)} copyLabel="Copy output" empty="No output." />
    </div>
  );
}

function HeaderTable({ title, headers }: { title: string; headers: Record<string, string> | undefined }) {
  const entries = Object.entries(headers ?? {});
  if (entries.length === 0) return null;
  return (
    <section className="space-y-1">
      <SectionHeading count={entries.length}>{title}</SectionHeading>
      <dl className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11px]/relaxed">
        {entries.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="break-all text-text-muted">{name}</dt>
            <dd className="break-all text-text-secondary">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RequestRow({ trace, request, open, onToggle, onSelectStep }: { trace: BrowseTrace; request: BrowseTraceRequest; open: boolean; onToggle(): void; onSelectStep(index: number): void }) {
  const failed = requestFailed(request);
  const bar = requestWaterfall(trace, request);
  const body = prettyText(request.responseBody);
  return (
    <li className="rounded-md">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="grid w-full grid-cols-[3rem_2.5rem_minmax(0,1fr)_4rem] items-center gap-x-2 rounded-md px-1 py-1.5 text-start font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-secondary min-[900px]:grid-cols-[3rem_2.5rem_minmax(0,1fr)_4rem_3.5rem_4rem_8rem]"
      >
        <span className="font-semibold text-text-secondary">{request.method}</span>
        <span className={cn("font-semibold tabular-nums", failed ? "text-destructive" : "text-text-secondary")}>{request.error ? "ERR" : (request.status ?? "…")}</span>
        <span className="min-w-0 truncate text-text-muted" title={request.url}>
          {shortUrl(request.url)}
        </span>
        <span className="truncate text-text-muted">{request.type ?? ""}</span>
        <span className="hidden text-end tabular-nums text-text-muted min-[900px]:block">{request.size !== undefined ? formatBytes(request.size) : ""}</span>
        <span className="hidden text-end tabular-nums text-text-muted min-[900px]:block">{request.durationMs !== undefined ? formatDuration(request.durationMs) : ""}</span>
        <span aria-hidden className="relative hidden h-1.5 rounded-full bg-surface-elevated min-[900px]:block">
          <span
            data-testid="request-bar"
            className={cn("absolute inset-y-0 rounded-full", failed ? "bg-destructive" : "bg-accent-primary")}
            style={{ left: `${bar.startPct}%`, width: `${bar.widthPct}%` }}
          />
        </span>
      </button>
      {open && (
        <div className="mx-1 mb-1.5 space-y-3 rounded-lg bg-surface-elevated px-3 py-2">
          <p className="font-mono text-[11px]/relaxed break-all text-text-secondary">{request.url}</p>
          {request.error && <p className="text-xs break-words text-destructive">{request.error}</p>}
          <p className="text-[11px] text-text-muted">
            {formatOffset(request.at - trace.startedAt)}
            {request.mimeType && ` · ${request.mimeType}`}
            {request.stepIndex !== undefined && (
              <>
                {" · "}
                <button type="button" className="underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelectStep(request.stepIndex!)}>
                  Step {request.stepIndex + 1}
                </button>
              </>
            )}
          </p>
          <HeaderTable title="Request headers" headers={request.requestHeaders} />
          <HeaderTable title="Response headers" headers={request.responseHeaders} />
          {body ? (
            <section className="space-y-1">
              <SectionHeading>Response body</SectionHeading>
              <pre className="max-h-48 overflow-auto rounded-md bg-surface-panel p-2 font-mono text-[11px]/relaxed break-words whitespace-pre-wrap text-text-secondary">{body}</pre>
              {request.bodyTruncated && <p className="text-[11px] text-text-muted">Body truncated.</p>}
            </section>
          ) : null}
        </div>
      )}
    </li>
  );
}

interface RequestsProps {
  trace: BrowseTrace;
  requests: BrowseTraceRequest[];
  selectedStep: number | null;
  filter: LogFilter;
  onFilter(filter: LogFilter): void;
  failedOnly: boolean;
  onFailedOnly(on: boolean): void;
  onSelectStep(index: number): void;
}

/** Every request of the run, with a waterfall and details. */
function RequestsPanel({ trace, requests: all, selectedStep, filter, onFilter, failedOnly, onFailedOnly, onSelectStep }: RequestsProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const scoped = filterLogEntries(all, filter, stepOf(trace, selectedStep), requestText);
  const requests = failedOnly ? scoped.filter(requestFailed) : scoped;
  const dropped = droppedRequests(trace);
  const keys = new Map(all.map((request, i) => [request, `${request.at}-${i}`]));
  return (
    <>
      <LogToolbar kind="requests" filter={filter} onChange={onFilter} canScope={selectedStep !== null} shown={requests.length} total={all.length}>
        <Segmented
          label="Request status"
          value={failedOnly ? "failed" : "all"}
          options={[
            { value: "all", label: "All" },
            { value: "failed", label: "Failed only" },
          ]}
          onChange={(v) => onFailedOnly(v === "failed")}
        />
      </LogToolbar>
      {requests.length === 0 ? (
        <Empty title="Nothing matches" hint="Change the filter to see more." />
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {requests.map((request) => {
            const key = keys.get(request)!;
            return <RequestRow key={key} trace={trace} request={request} open={openKey === key} onToggle={() => setOpenKey(openKey === key ? null : key)} onSelectStep={onSelectStep} />;
          })}
        </ul>
      )}
      {dropped ? <p className="mt-3 text-xs text-text-muted">{dropped} more not recorded.</p> : null}
    </>
  );
}

interface Props {
  trace: BrowseTrace;
  selectedStep: number | null;
  onSelectStep(index: number): void;
  /** Whether "Copy link to this step" makes sense (the page address names the trace). */
  canLink?: boolean;
}

export const Inspector = memo(function Inspector({ trace, selectedStep, onSelectStep, canLink = true }: Props) {
  const failedChecks = trace.qa?.checks?.filter((c) => !c.passed).length ?? 0;
  const requests = traceRequests(trace);
  const failedRequests = requests.filter(requestFailed).length;
  // Filters live here: a tab's panel unmounts when another tab opens.
  const [consoleFilter, setConsoleFilter] = useState<LogFilter>(NO_LOG_FILTER);
  const [networkFilter, setNetworkFilter] = useState<LogFilter>(NO_LOG_FILTER);
  const [failedOnly, setFailedOnly] = useState(false);
  return (
    <Tabs defaultValue="step" className="min-h-0 flex-1 gap-0 bg-surface-panel">
      <div className={cn(BAR_ROW, "shrink-0")}>
        <TabsList aria-label="Details">
          <TabsTrigger value="step">Step</TabsTrigger>
          <TabsTrigger value="console">
            Console <Count n={trace.console.length} />
          </TabsTrigger>
          <TabsTrigger value="network">
            Network <Count n={requests.length > 0 ? requests.length : trace.network.length} />
            {failedRequests > 0 && <span className="tabular-nums text-destructive">{failedRequests} failed</span>}
          </TabsTrigger>
          <TabsTrigger value="qa">
            QA {failedChecks > 0 && <Count n={failedChecks} />}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="step" className="min-h-0 overflow-y-auto px-3 pb-3">
        <StepPanel key={selectedStep} trace={trace} selectedStep={selectedStep} canLink={canLink} />
      </TabsContent>
      <TabsContent value="console" className="min-h-0 overflow-y-auto px-2 pb-3">
        <LogPanel trace={trace} entries={trace.console} droppedCount={trace.dropped?.console} selectedStep={selectedStep} kind="console" filter={consoleFilter} onFilter={setConsoleFilter} onSelectStep={onSelectStep} />
      </TabsContent>
      <TabsContent value="network" className="min-h-0 overflow-y-auto px-2 pb-3">
        {requests.length > 0 ? (
          <RequestsPanel trace={trace} requests={requests} selectedStep={selectedStep} filter={networkFilter} onFilter={setNetworkFilter} failedOnly={failedOnly} onFailedOnly={setFailedOnly} onSelectStep={onSelectStep} />
        ) : (
          <LogPanel trace={trace} entries={trace.network} droppedCount={trace.dropped?.network} selectedStep={selectedStep} kind="network" filter={networkFilter} onFilter={setNetworkFilter} onSelectStep={onSelectStep} />
        )}
      </TabsContent>
      <TabsContent value="qa" className="min-h-0 overflow-y-auto px-3 pb-3">
        <QaPanel trace={trace} />
      </TabsContent>
    </Tabs>
  );
});
