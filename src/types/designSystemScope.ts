import type { CollectionId, ModeId, VariableScope } from "./variable";

/**
 * A named slice of the design system, saved in the `.pen` file. The agent asks
 * for one by name (`get_design_system { scope: { saved } }`) instead of
 * spelling out filters each time. Every field is optional; an absent field
 * filters nothing.
 */
export interface DesignSystemScope {
  id: string;
  name: string;
  description?: string;
  /** Collection ids or names to keep. */
  collections?: CollectionId[];
  /** Per collection id: the mode ids whose values are listed. */
  modes?: Record<CollectionId, ModeId[]>;
  components?: {
    /** Component keys to keep. */
    keys?: string[];
    status?: ("draft" | "stable" | "deprecated")[];
  };
  /** Keep variables that carry at least one of these scopes (unscoped variables always pass). */
  tokenScopes?: VariableScope[];
  /** Name globs (`*`, `?`; `\\*` and `\\?` are literal) matched against token names. They never filter components. */
  names?: string[];
}

export function generateDesignSystemScopeId(): string {
  return "dsscope_" + Math.random().toString(36).substring(2, 9);
}
