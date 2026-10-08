import { LINT_RULE_IDS, type LintRuleId, type Severity } from "./types";

/** One lint rule, as shown to the agent and the lint panel. */
export interface LintRuleInfo {
  id: LintRuleId;
  /** Severity of the usual finding; a rule may lower it for a weaker case (for example info for a gradient). */
  defaultSeverity: Severity;
  description: string;
  /** True when at least some findings of the rule carry a machine-applicable fix. */
  autoFix: boolean;
}

const CATALOG: Record<LintRuleId, Omit<LintRuleInfo, "id">> = {
  "hardcoded-value": {
    defaultSeverity: "warning",
    description: "A raw color or number that equals a design token. Bind the token instead.",
    autoFix: true,
  },
  "off-scale-value": {
    defaultSeverity: "info",
    description: "A raw color or number that is near a token but not equal to it. A number fix changes the value.",
    autoFix: true,
  },
  contrast: {
    defaultSeverity: "error",
    description: "Text, native or inside an embed, below the WCAG AA contrast ratio against its backdrop.",
    autoFix: false,
  },
  "deprecated-token": {
    defaultSeverity: "warning",
    description: "A binding to a token marked deprecated, directly or through an alias chain.",
    autoFix: true,
  },
  "deprecated-component": {
    defaultSeverity: "warning",
    description: "An embed that uses a component marked deprecated.",
    autoFix: false,
  },
  "embed-literal": {
    defaultSeverity: "warning",
    description: "A raw color or px length in embed HTML where a var(--token) fits.",
    autoFix: true,
  },
  "component-drift": {
    defaultSeverity: "warning",
    description: "A component instance that is out of date, has no master, is detached, or has a duplicate master.",
    autoFix: true,
  },
};

/** Every lint rule, in the order findings are sorted. */
export const LINT_RULE_CATALOG: readonly LintRuleInfo[] = LINT_RULE_IDS.map((id) => ({ id, ...CATALOG[id] }));
