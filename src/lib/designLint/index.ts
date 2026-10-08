import { LintContext } from "./context";
import { runRules } from "./rules";
import {
  LINT_RULE_IDS,
  SEVERITY_ORDER,
  type Finding,
  type LintInput,
  type LintOptions,
  type LintResult,
  type LintRuleId,
  type LintSummary,
  type Severity,
} from "./types";

export * from "./types";
export * from "./colorMath";
export { LINT_RULE_CATALOG, type LintRuleInfo } from "./ruleCatalog";
export { buildLintInput, enumerateModeContexts, modeLabel } from "./context";

export const DEFAULT_LIMIT = 100;

function ruleRank(rule: LintRuleId): number {
  return LINT_RULE_IDS.indexOf(rule);
}

/**
 * Lint one page (plus the embeds of every page). Pure: all data comes in
 * through `input`. Findings are ordered by severity, rule, then scene order,
 * and the summary always counts all of them even when `limit` cuts the list.
 */
export function runDesignLint(input: LintInput, opts: LintOptions = {}): LintResult {
  const lc = new LintContext(input, opts);
  const enabled = new Set<LintRuleId>(opts.rules?.length ? opts.rules : LINT_RULE_IDS);
  runRules(lc, enabled);

  const minRank = opts.severity ? SEVERITY_ORDER.indexOf(opts.severity) : SEVERITY_ORDER.length - 1;
  const sceneOrder = new Map(lc.scopeIds.map((id, i) => [id, i]));
  const embedOrder = new Map(input.embeds.map((e, i) => [e.nodeId, i]));
  const position = (f: Finding) => sceneOrder.get(f.nodeId) ?? 1e9 + (embedOrder.get(f.nodeId) ?? 0);
  const kept = lc.findings
    .filter((f) => SEVERITY_ORDER.indexOf(f.severity) <= minRank)
    .map((f, i) => ({ f, i }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.f.severity) - SEVERITY_ORDER.indexOf(b.f.severity) ||
        ruleRank(a.f.rule) - ruleRank(b.f.rule) ||
        position(a.f) - position(b.f) ||
        a.i - b.i,
    )
    .map((x) => x.f);

  const summary: LintSummary = {
    errors: 0,
    warnings: 0,
    info: 0,
    byRule: {},
    scanned: { nodes: lc.scopeIds.length, embeds: lc.embeds.length },
  };
  if (lc.embedsPartial > 0) summary.scanned.embedsPartial = lc.embedsPartial;
  for (const f of kept) {
    const key: Record<Severity, "errors" | "warnings" | "info"> = { error: "errors", warning: "warnings", info: "info" };
    summary[key[f.severity]]++;
    summary.byRule[f.rule] = (summary.byRule[f.rule] ?? 0) + 1;
  }

  const limit = opts.limit ?? DEFAULT_LIMIT;
  const cut = kept.length > limit;
  return { findings: cut ? kept.slice(0, limit) : kept, summary, truncated: lc.truncated || cut };
}
