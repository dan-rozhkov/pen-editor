import type { ModeContext, Variable, VariableCollection, VariableScope } from "@/types/variable";
import type { ComponentMaster } from "@/lib/embedComponents";
import type { DesignSystemScope } from "@/types/designSystemScope";

export type ComponentStatus = "draft" | "stable" | "deprecated";
export type DesignSystemSection = "tokens" | "components" | "lint";

export const DEFAULT_LIMIT = 400;
/** Max `tokenUses` entries kept per component. */
export const MAX_TOKEN_USES = 40;

/** One registered component plus the facts only the stores know. */
export interface ComponentInput {
  master: ComponentMaster;
  usage: { instances: number; embeds: number };
  warnings: string[];
}

/** Everything the builder reads. The caller gathers it from the stores. */
export interface DesignSystemInput {
  variables: Variable[];
  collections: VariableCollection[];
  /** The document mode context (may be partial; the builder completes it). */
  modeContext: ModeContext;
  components: ComponentInput[];
  savedScopes: DesignSystemScope[];
  /** The lint rule catalog. It comes from the lint engine; omit it when that engine is absent. */
  lintRules?: LintRuleInfo[];
}

export interface LintRuleInfo {
  id: string;
  severity: "error" | "warning" | "info";
  description: string;
  autoFix: boolean;
}

/** Scope filters as the agent writes them. */
export interface DesignSystemScopeArgs {
  saved?: string;
  collections?: string[];
  components?: string[];
  componentStatus?: ComponentStatus[];
  tokenScopes?: VariableScope[];
  /** Token name globs. They filter tokens only; `components` filters components. */
  names?: string[];
}

export interface DesignSystemArgs {
  scope?: DesignSystemScopeArgs;
  /** A Theme mode, or one mode per collection name. */
  mode?: string | Record<string, string>;
  include?: DesignSystemSection[];
  limit?: number;
}

export interface DesignSystemCollection {
  id: string;
  name: string;
  /** `semantic` when a variable of the collection aliases a variable of another collection. */
  tier: "primitive" | "semantic";
  modes: { id: string; name: string }[];
  defaultModeId: string;
}

export interface TokenModeValue {
  raw: string;
  resolved: string | null;
  error?: string;
}

export interface DesignSystemToken {
  name: string;
  cssName: string;
  collection: string;
  type: Variable["type"];
  scopes: VariableScope[];
  description?: string;
  /** Mode name -> raw and resolved value. `resolved` is null, with an `error` reason, when the alias chain fails. */
  values: Record<string, TokenModeValue>;
  deprecated?: { since?: string; replacedBy?: string; note?: string };
}

export interface ComponentTokenUse {
  /** The rule selector, prefixed by any enclosing at-rule preludes. */
  selector: string;
  property: string;
  /** CSS custom-property name used in `var(...)`. */
  token: string;
  /** Value under the requested mode context; null when nothing resolves it. */
  resolved: string | null;
}

export interface DesignSystemComponent {
  key: string;
  name: string;
  status: ComponentStatus;
  description?: string;
  variants: Record<string, string[]>;
  slots: string[];
  usage: { instances: number; embeds: number };
  tokenUses: ComponentTokenUse[];
  deprecated?: { replacedBy?: string; note?: string };
  warnings: string[];
}

/** The scope that was actually applied (saved scope merged with explicit filters). */
export interface AppliedScope {
  collections?: string[];
  modes?: Record<string, string[]>;
  components?: string[];
  componentStatus?: ComponentStatus[];
  tokenScopes?: VariableScope[];
  names?: string[];
}

export interface DesignSystemResult {
  schema: 1;
  scope: { saved: string | null; applied: AppliedScope };
  /** One mode id per collection id, completed with defaults. */
  modeContext: ModeContext;
  collections: DesignSystemCollection[];
  tokens?: DesignSystemToken[];
  components?: DesignSystemComponent[];
  lint?: { rules: LintRuleInfo[]; available: boolean };
  truncated: boolean;
  hint?: string;
}
