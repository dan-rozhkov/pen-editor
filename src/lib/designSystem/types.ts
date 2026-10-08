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
  lint?: {
    rules: LintRuleInfo[];
    available: boolean;
    /** Findings per rule id under the resolved mode context. Present only when the caller added it. */
    counts?: Record<string, number>;
    /** True when the count scan stopped at its budget, so `counts` may be low. */
    countsTruncated?: boolean;
    /**
     * What `counts` covers: "components" when the scope named components (only
     * findings in those components and the embeds that use them), "page" when
     * it did not (token-only scopes do not narrow counts: they stay page-wide).
     */
    countsScope?: "page" | "components";
  };
  truncated: boolean;
  hint?: string;
}

// Snapshot v1: the wire shape of one published library version. Mirrors
// pen-editor-backend/src/ds/snapshotSchema.ts; the spec is
// docs/superpowers/specs/2026-10-08-ds-library-snapshot-v1.md.

export const SUPPORTED_SCHEMA_VERSION = 1;
export const MAX_README_BYTES = 20 * 1024;
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export type SnapshotModeValue = string | { alias: string };

export interface SnapshotDeprecation {
  since?: string;
  replacedBy?: string;
  note?: string;
}

export interface SnapshotCollection {
  id: string;
  name: string;
  modes: Array<{ id: string; name: string }>;
  defaultModeId: string;
}

export interface SnapshotVariable {
  id: string;
  name: string;
  type: "color" | "number" | "string";
  collectionId: string;
  valuesByMode: Record<string, SnapshotModeValue>;
  description?: string;
  scopes?: string[];
  deprecated?: SnapshotDeprecation;
}

export interface SnapshotComponent {
  key: string;
  html: string;
  rev: string;
  meta: {
    name: string;
    description?: string;
    variants?: Record<string, string[]>;
    status?: "draft" | "stable" | "deprecated";
    deprecated?: SnapshotDeprecation;
  };
}

export interface Snapshot {
  schemaVersion: number;
  collections: SnapshotCollection[];
  variables: SnapshotVariable[];
  components: SnapshotComponent[];
  docs?: { readme: string };
}

export type Bump = "major" | "minor" | "patch";
export type RequiredBump = Bump | "none" | "initial";
export type ChangeKind = "added" | "removed" | "changed" | "deprecated";

export interface Change {
  kind: ChangeKind;
  /** `collection:<id>`, `mode:<collectionId>/<modeId>`, `variable:<id>`, `component:<key>`, or `snapshot`. */
  entity: string;
  bump: Bump;
  reason: string;
}

export interface DiffSummary {
  added: number;
  changed: number;
  deprecated: number;
  removed: number;
}

export interface SnapshotDiff {
  requiredBump: RequiredBump;
  changes: Change[];
  summary: DiffSummary;
  /** Entities present before and gone now, sorted. */
  removed: string[];
  /** Entities new in `next`, sorted. */
  added: string[];
}

export interface Violation {
  code: "removal_not_deprecated" | "replacement_missing" | "replacement_type_mismatch";
  entity: string;
  message: string;
}

export type Migration =
  | { op: "rebindToken"; from: string; to: string; cssFrom: string; cssTo: string }
  /** A surviving variable whose CSS name changed: `var(cssFrom)` in consumer markup becomes `var(cssTo)`. */
  | { op: "renameToken"; id: string; cssFrom: string; cssTo: string }
  /** `valueFrom` is set only by composition: freeze `id` with the value of that (rebound-to) token instead of its own. */
  | { op: "freezeToken"; id: string; valueFrom?: string }
  | { op: "remapComponent"; from: string; to: string }
  | { op: "removeComponent"; key: string }
  | { op: "dropMode"; collection: string; mode: string }
  | { op: "remapVariant"; key: string; axis: string; map: Record<string, string> };

/** One library a document is linked to. */
export interface LibraryPin {
  id: string;
  name: string;
  version: string;
  /** Opt-in usage upload (Phase 7). Stripped from shared documents. */
  reportUsage?: boolean;
  /** The newest version the user chose to ignore ("stay pinned"). */
  dismissedVersion?: string;
}

/** Set on the document that authors a library. */
export interface LibraryAuthor {
  libraryId: string;
  /** The latest version this document was diffed against, or null before the first publish. */
  baseVersion: string | null;
  name: string;
}

/** Records one change while a diff walks the snapshots. */
export type ChangeSink = (kind: ChangeKind, entity: string, bump: Bump, reason: string) => void;
