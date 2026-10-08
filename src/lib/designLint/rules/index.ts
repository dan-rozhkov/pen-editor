import type { LintContext } from "../context";
import { LINT_RULE_IDS, type LintRuleId } from "../types";
import { runContrastRule } from "./contrast";
import { runEmbedRules } from "./embedRules";
import { runDeprecatedTokenRule, runValueRules } from "./tokenRules";

export function allRules(): readonly LintRuleId[] {
  return LINT_RULE_IDS;
}

/** Run every enabled rule against the context; findings land in `lc.findings`. */
export function runRules(lc: LintContext, enabled: ReadonlySet<LintRuleId>): void {
  runValueRules(lc, enabled);
  if (enabled.has("deprecated-token")) runDeprecatedTokenRule(lc);
  if (enabled.has("contrast")) runContrastRule(lc);
  runEmbedRules(lc, enabled);
}
