import type { FlatSceneNode, NumberBindingKey } from "@/types/scene";
import type { ModeContext, ModeOverrides, Variable, VariableCollection } from "@/types/variable";
import type { ComponentRegistry } from "@/lib/embedComponents";

export type Severity = "error" | "warning" | "info";

/** Highest first; the order findings are sorted in. */
export const SEVERITY_ORDER: readonly Severity[] = ["error", "warning", "info"];

export const LINT_RULE_IDS = [
  "hardcoded-value",
  "off-scale-value",
  "contrast",
  "deprecated-token",
  "deprecated-component",
  "embed-literal",
  "component-drift",
] as const;

export type LintRuleId = (typeof LINT_RULE_IDS)[number];

/** What a paint slot of a node is bound to. `paintId` is absent for the legacy single fill / stroke. */
export type ColorSlot = "fill" | "stroke";

/**
 * A machine-applicable repair. Fixes carry the value they expect to find
 * (`from`) so the applier can re-validate against the live document before
 * writing and skip a fix that went stale.
 */
export type LintFix =
  | {
      kind: "bind-color";
      nodeId: string;
      slot: ColorSlot;
      paintId?: string;
      variableId: string;
      /** The literal color being replaced. */
      from: string;
    }
  | {
      kind: "bind-number";
      nodeId: string;
      key: NumberBindingKey;
      variableId: string;
      from: number;
      /** True when the token value differs from the literal (off-scale snap). */
      changesValue: boolean;
    }
  | {
      kind: "embed-replace";
      nodeId: string;
      /** CSS property whose value holds `from`. */
      property: string;
      from: string;
      to: string;
    }
  | {
      kind: "rebind";
      nodeId: string;
      target: ColorSlot | NumberBindingKey;
      paintId?: string;
      fromVariableId: string;
      toVariableId: string;
    }
  | { kind: "reconcile-component"; key: string; nodeId: string };

export interface Finding {
  /** Stable across runs while the offending thing stays the same. */
  id: string;
  rule: LintRuleId;
  severity: Severity;
  nodeId: string;
  pageId: string;
  /** Element or stylesheet rule inside an embed. */
  embedPath?: string;
  message: string;
  detail?: string;
  /** Mode context the finding holds in (contrast, and hardcoded values that match a token in that mode). */
  mode?: string;
  fix?: LintFix;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An embed from any page. */
export interface LintEmbed {
  nodeId: string;
  pageId: string;
  html: string;
  /** Set on a component master. */
  masterKey?: string;
  /**
   * Mode overrides of the embed's ancestor frames, outermost first. Only set
   * for embeds on other pages (the active page reads them from its own tree).
   */
  modeChain?: ModeOverrides[];
}

/**
 * Everything the lint needs, as plain data. `buildLintInput` is the only
 * place that reads stores; tests build this object by hand.
 */
export interface LintInput {
  pageId: string;
  nodesById: Readonly<Record<string, FlatSceneNode>>;
  parentById: Readonly<Record<string, string | null>>;
  childrenById: Readonly<Record<string, string[]>>;
  rootIds: readonly string[];
  /** Absolute, layout-aware rects of the page's nodes. */
  rects: Readonly<Record<string, Rect>>;
  pageBackground: string;
  variables: Variable[];
  collections: VariableCollection[];
  /** The document mode context. */
  baseModes: ModeContext;
  registry: ComponentRegistry;
  /** key -> node ids of masters that lost to the registry winner. */
  duplicateMasters: ReadonlyMap<string, string[]>;
  embeds: readonly LintEmbed[];
}

export interface LintOptions {
  /** Limit the scan to these nodes and their descendants. */
  nodeIds?: readonly string[];
  rules?: readonly LintRuleId[];
  /** Mode contexts to evaluate. Default: every combination, at most `maxModes`. */
  modes?: readonly ModeContext[];
  maxModes?: number;
  /** Lowest severity to keep. */
  severity?: Severity;
  /** Findings to return (summary still counts all). Default 100. */
  limit?: number;
  maxNodes?: number;
  maxEmbeds?: number;
  /** Wall-clock budget; findings so far are returned with `truncated`. */
  budgetMs?: number;
  now?: () => number;
  /** Also check strokes of shapes against 3:1 (WCAG non-text contrast). Off by default. */
  uiContrast?: boolean;
  /**
   * Counts fast path: skip fix retention and sorting, and return `findings: []`
   * with only the summary filled in.
   */
  countsOnly?: boolean;
  /** With `countsOnly`: only findings this accepts reach the summary. */
  countFilter?: (finding: Finding) => boolean;
}

export interface LintSummary {
  errors: number;
  warnings: number;
  info: number;
  byRule: Partial<Record<LintRuleId, number>>;
  scanned: { nodes: number; embeds: number; embedsPartial?: number };
}

export interface LintResult {
  findings: Finding[];
  summary: LintSummary;
  /** Findings were cut by `limit`, or the scan stopped early (`scanTruncated`). */
  truncated: boolean;
  /** A scan cap or the time budget stopped the run before everything was checked. */
  scanTruncated: boolean;
}
