import { useVariableStore } from "@/store/variableStore";
import { getVariableCssName, getVariableValue } from "@/types/variable";
import type { ThemeName } from "@/types/variable";

/**
 * Resolve current variable values to a `name -> CSS value` map, for the
 * given theme. Shared by `buildVariableStyleBlock` (the one-time mount-time
 * `<style>` block) and `EmbedLayer.tsx`'s live-update effect
 * (`applyEditorVariableProperties` in `embedHtmlUtils.ts`), so the two paths
 * can never resolve a variable to two different values.
 *
 * @param variableIds - If provided, only include variables with these IDs.
 *                      If omitted, include all variables.
 * @param theme - If provided, use this theme instead of the global active theme.
 */
export function collectVariableValues(variableIds?: Set<string>, theme?: ThemeName): Map<string, string> {
  const { variables } = useVariableStore.getState();
  const activeTheme = theme ?? 'light';
  const values = new Map<string, string>();
  for (const v of variables) {
    if (variableIds && !variableIds.has(v.id)) continue;
    // Keyed by the CANONICAL CSS name, not `v.name` — `v.name` is a
    // free-form label ("Color 1") and setting it directly on `root.style`
    // would be a silent no-op. See `getVariableCssName`'s doc comment.
    values.set(getVariableCssName(v), getVariableValue(v, activeTheme));
  }
  return values;
}

/**
 * Build a `<style>:root { ... }</style>` block with current variable values.
 *
 * @param variableIds - If provided, only include variables with these IDs.
 *                      If omitted, include all variables.
 * @param theme - If provided, use this theme instead of the global active theme.
 */
export function buildVariableStyleBlock(variableIds?: Set<string>, theme?: ThemeName): string {
  const values = collectVariableValues(variableIds, theme);
  if (values.size === 0) return "";

  const declarations = Array.from(values, ([name, value]) => `${name}: ${value};`);
  return `<style>:root { ${declarations.join(" ")} }</style>`;
}
