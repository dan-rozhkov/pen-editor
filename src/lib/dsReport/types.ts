import type { FlatSceneNode } from "@/types/scene";
import type { Variable } from "@/types/variable";
import type { ComponentRegistry } from "@/lib/embedComponents";
import type { LibraryPin } from "@/lib/designSystem/types";
import type { LintInput, LintRuleId } from "@/lib/designLint";

export const USAGE_REPORT_SCHEMA_VERSION = 1;

/** Caps, like the lint: a huge document gets a partial report that says so. */
export const USAGE_MAX_NODES = 20_000;
export const USAGE_MAX_EMBEDS = 50;
export const USAGE_MAX_EMBED_CHARS = 200_000;
export const USAGE_BUDGET_MS = 4_000;
/** Max ids listed under `unusedTokenIds` / `unusedComponentKeys` per library. */
export const USAGE_MAX_UNUSED_LISTED = 50;

export interface UsagePage {
  id: string;
  nodesById: Readonly<Record<string, FlatSceneNode>>;
  /** The tree, so a hidden node hides its whole subtree. */
  rootIds: readonly string[];
  childrenById: Readonly<Record<string, readonly string[]>>;
}

/** Everything the report reads, as plain data. `buildUsageInput` is the only impure function. */
export interface UsageInput {
  pages: readonly UsagePage[];
  variables: readonly Variable[];
  registry: ComponentRegistry;
  /** The document's library pins; the source of each library's version. */
  pins?: readonly LibraryPin[];
  /** The lint input (active page plus all embeds). Omit it to skip lint counts. */
  lint?: LintInput | null;
}

export interface UsageOptions {
  maxNodes?: number;
  maxEmbeds?: number;
  maxEmbedChars?: number;
  budgetMs?: number;
  now?: () => number;
}

/** Counts only. Keys of `use` maps are library variable ids or library component keys, nothing else. */
export interface UsageReport {
  schemaVersion: 1;
  /** Visible nodes counted, over all pages. */
  nodes: number;
  embeds: number;
  tokens: {
    /** Properties of scene nodes that could carry a token. */
    bindable: number;
    /** Includes `styled`. */
    bound: number;
    boundToLibrary: number;
    /** Paints that use a paint style: counted as bindable and bound. */
    styled: number;
    /** Bindable properties that still hold a literal. */
    literal: number;
    /** Token uses per library variable id (scene bindings plus `var()` in embeds). */
    use: Record<string, number>;
    /** Embed CSS: `var(--token)` references against hardcoded colors. */
    embed: { varRefs: number; unknownVarRefs: number; literals: number };
    /** CSS names that two or more tokens share; the library token wins. */
    cssNameCollisions: number;
  };
  components: {
    /** Regions of registered components placed in embeds. */
    instances: number;
    libraryInstances: number;
    /** Detached copies (one `data-d-style` block each). */
    detached: number;
    /** Instances per library component key. */
    use: Record<string, number>;
    /** Detached copies per library component key. */
    detachedByKey: Record<string, number>;
  };
  /** Finding counts per rule on the active page; null when no lint input was given. */
  lint: Record<LintRuleId, number> | null;
  libraries: LibraryUsage[];
  /** A cap or the time budget stopped the scan, so numbers may be low. */
  truncated: boolean;
}

export interface LibraryUsage {
  libraryId: string;
  /** The pinned version; without a pin, the version on a library component, else null. */
  version: string | null;
  /** The pin's opt-in to share counts with the library owner. */
  reportUsage: boolean;
  tokens: { total: number; used: number; unused: number };
  components: { total: number; used: number; unused: number };
  unusedTokenIds: string[];
  unusedComponentKeys: string[];
}
