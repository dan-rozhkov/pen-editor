import { useId, useMemo, type ReactNode } from "react";
import { ArrowClockwiseIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { useVariableStore } from "@/store/variableStore";
import { useLintStore, type LintModeChoice } from "@/store/lintStore";
import { LINT_RULE_CATALOG, LINT_RULE_IDS, type Finding, type LintRuleId, type Severity } from "@/lib/designLint";
import { THEME_COLLECTION_ID } from "@/types/variable";
import { Button } from "@/components/ui/button";
import { PanelEmptyState } from "@/components/PanelEmptyState";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/designLint/plural";
import { useLintAutoRun } from "@/hooks/useLintAutoRun";

const RULE_LABELS: Record<LintRuleId, string> = {
  "hardcoded-value": "Hardcoded values",
  "off-scale-value": "Values off the scale",
  contrast: "Contrast",
  "deprecated-token": "Deprecated tokens",
  "deprecated-component": "Deprecated components",
  "embed-literal": "Embed literals",
  "component-drift": "Component drift",
};

const SEVERITY_LABELS: Record<Severity, string> = { error: "Error", warning: "Warning", info: "Info" };
const SEVERITY_CLASS: Record<Severity, string> = {
  error: "bg-destructive/10 text-destructive",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  info: "bg-secondary text-text-muted",
};


function ModePicker() {
  const mode = useLintStore((s) => s.mode);
  const setMode = useLintStore((s) => s.setMode);
  const collections = useVariableStore((s) => s.collections);
  const id = useId();
  const themeModes = collections.find((c) => c.id === THEME_COLLECTION_ID)?.modes ?? [];
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-text-muted">
        Mode
      </label>
      <select
        id={id}
        value={mode}
        onChange={(e) => setMode(e.target.value as LintModeChoice)}
        className="h-6 min-w-0 flex-1 rounded-md border border-input bg-surface-panel px-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-accent-light"
      >
        <option value="current">Current mode</option>
        <option value="all">All modes</option>
        {themeModes.map((m) => (
          <option key={m.id} value={m.name}>
            {m.name} theme
          </option>
        ))}
      </select>
    </div>
  );
}

function Summary() {
  const summary = useLintStore((s) => s.summary);
  const otherPages = useLintStore((s) => s.otherPages);
  const truncated = useLintStore((s) => s.truncated);
  const scanTruncated = useLintStore((s) => s.scanTruncated);
  const partial = useLintStore((s) => s.partial);
  if (!summary) return null;
  return (
    <div className="flex flex-col gap-1 text-xs text-text-muted">
      <p data-testid="lint-summary" className="text-text-default">
        {plural(summary.errors, "error")}, {plural(summary.warnings, "warning")}, {summary.info} info
      </p>
      <p>
        Checked {plural(summary.nodes, "layer")} and {plural(summary.embeds, "embed")} on this page.
      </p>
      {otherPages > 0 && (
        <p data-testid="lint-other-pages">
          {plural(otherPages, "more finding")} in embeds on other pages. Open that page to fix {otherPages === 1 ? "it" : "them"}.
        </p>
      )}
      {partial && <p>The quick check stopped early to keep the editor responsive. Select Check again for a full check.</p>}
      {scanTruncated && !partial && <p>The check stopped at a size limit, so part of the design was not checked.</p>}
      {truncated && !scanTruncated && <p>Showing the first findings only.</p>}
    </div>
  );
}

function RuleFilters({ counts }: { counts: Partial<Record<LintRuleId, number>> }) {
  const filter = useLintStore((s) => s.ruleFilter);
  const setFilter = useLintStore((s) => s.setRuleFilter);
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const chip = (rule: LintRuleId | null, label: string, count: number) => (
    <button
      key={rule ?? "all"}
      type="button"
      aria-pressed={filter === rule}
      onClick={() => setFilter(rule)}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-light",
        filter === rule
          ? "border-accent-primary bg-accent-selection text-accent-primary"
          : "border-border-default text-text-muted hover:bg-secondary",
      )}
    >
      {label} {count}
    </button>
  );
  return (
    <div role="group" aria-label="Filter by rule" className="flex flex-wrap gap-1">
      {chip(null, "All", total)}
      {LINT_RULE_IDS.filter((r) => (counts[r] ?? 0) > 0).map((r) => chip(r, RULE_LABELS[r], counts[r] ?? 0))}
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const select = useLintStore((s) => s.select);
  const fix = useLintStore((s) => s.fix);
  const fixable = useLintStore((s) => !!s.fixable[finding.id]);
  const inLibrary = useLintStore((s) => !!s.library[finding.id]);
  const changesValue = finding.fix?.kind === "bind-number" && finding.fix.changesValue;
  return (
    <li data-testid="lint-finding" data-finding-id={finding.id} className="flex flex-col gap-1.5 border-b border-border-light px-3 py-2">
      <div className="flex items-start gap-2">
        <span className={cn("mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", SEVERITY_CLASS[finding.severity])}>
          {SEVERITY_LABELS[finding.severity]}
        </span>
        <p className="min-w-0 flex-1 break-words text-xs text-text-default">{finding.message}</p>
      </div>
      {finding.detail && <p className="break-words text-[11px] text-text-muted">{finding.detail}</p>}
      {finding.mode && <p className="text-[11px] text-text-muted">In {finding.mode}</p>}
      {inLibrary && <p className="text-[11px] text-text-muted">Library component. Edit it in the library document.</p>}
      <div className="flex items-center gap-1.5">
        <Button
          size="xs"
          variant="outline"
          onClick={() => select(finding)}
          aria-label={`Select the layer for: ${finding.message}`}
        >
          Select
        </Button>
        {fixable && (
          <Button
            size="xs"
            variant="secondary"
            onClick={() => fix(finding.id)}
            aria-label={`${changesValue ? "Fix and change the value" : "Fix"}: ${finding.message}`}
          >
            {changesValue ? "Fix and change value" : "Fix"}
          </Button>
        )}
      </div>
    </li>
  );
}

function RuleGroup({ rule, findings }: { rule: LintRuleId; findings: Finding[] }) {
  const fixAll = useLintStore((s) => s.fixAll);
  const headingId = useId();
  const fixableIds = useLintStore((s) => s.fixable);
  const fixable = findings.filter((f) => fixableIds[f.id]).length;
  const info = LINT_RULE_CATALOG.find((r) => r.id === rule);
  return (
    <section aria-labelledby={headingId} data-testid={`lint-group-${rule}`}>
      <div className="flex items-center gap-2 bg-secondary/40 px-3 py-1.5">
        <h3 id={headingId} className="min-w-0 flex-1 text-xs font-medium text-text-default" title={info?.description}>
          {RULE_LABELS[rule]} <span className="font-normal text-text-muted">{findings.length}</span>
        </h3>
        {fixable > 0 && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => fixAll(rule)}
            aria-label={`Fix all ${plural(fixable, "finding")} in ${RULE_LABELS[rule]}`}
          >
            Fix all in rule
          </Button>
        )}
      </div>
      <ul>
        {findings.map((f) => (
          <FindingRow key={f.id} finding={f} />
        ))}
      </ul>
    </section>
  );
}

function Header({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border-default px-3 py-3">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-xs font-medium text-text-default">Design lint</h2>
        {children}
      </div>
    </div>
  );
}

/** LeftRail section "lint": checks the active page against the design system and fixes what it can. */
export function LintPanelContent() {
  useLintAutoRun();
  const findings = useLintStore((s) => s.findings);
  const hasRun = useLintStore((s) => s.hasRun);
  const notice = useLintStore((s) => s.notice);
  const error = useLintStore((s) => s.error);
  const ruleFilter = useLintStore((s) => s.ruleFilter);
  const run = useLintStore((s) => s.run);
  const fixAll = useLintStore((s) => s.fixAll);

  const counts = useMemo(() => {
    const out: Partial<Record<LintRuleId, number>> = {};
    for (const f of findings) out[f.rule] = (out[f.rule] ?? 0) + 1;
    return out;
  }, [findings]);
  const groups = useMemo(
    () =>
      LINT_RULE_IDS.filter((r) => !ruleFilter || r === ruleFilter)
        .map((rule) => ({ rule, items: findings.filter((f) => f.rule === rule) }))
        .filter((g) => g.items.length > 0),
    [findings, ruleFilter],
  );
  const fixableIds = useLintStore((s) => s.fixable);
  const fixableTotal = findings.filter((f) => fixableIds[f.id]).length;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="lint-panel">
      <Header>
        {fixableTotal > 0 && (
          <Button size="xs" variant="default" onClick={() => fixAll()} aria-label={`Fix all ${plural(fixableTotal, "finding")} that have a fix`}>
            Fix all
          </Button>
        )}
        <Button size="xs" variant="outline" onClick={() => run()} aria-label="Check again">
          <ArrowClockwiseIcon aria-hidden />
          Check again
        </Button>
      </Header>
      <div className="flex flex-col gap-2 border-b border-border-default px-3 py-2">
        <ModePicker />
        <Summary />
        <RuleFilters counts={counts} />
      </div>
      <div role="status" aria-live="polite" className="px-3 text-xs text-text-muted empty:hidden">
        {error ?? notice}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasRun ? (
          <PanelEmptyState icon={<ArrowClockwiseIcon size={24} aria-hidden />}>Checking the design.</PanelEmptyState>
        ) : groups.length === 0 ? (
          <PanelEmptyState icon={<CheckCircleIcon size={24} aria-hidden />}>
            {findings.length === 0 ? "No findings. The design follows its tokens." : "No findings for this rule."}
          </PanelEmptyState>
        ) : (
          groups.map((g) => <RuleGroup key={g.rule} rule={g.rule} findings={g.items} />)
        )}
      </div>
    </div>
  );
}
