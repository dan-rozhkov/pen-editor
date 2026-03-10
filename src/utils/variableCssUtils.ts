import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { getVariableValue } from "@/types/variable";

/**
 * Build a `<style>:root { ... }</style>` block with current variable values.
 *
 * @param variableIds - If provided, only include variables with these IDs.
 *                      If omitted, include all variables.
 */
export function buildVariableStyleBlock(variableIds?: Set<string>): string {
  const { variables } = useVariableStore.getState();
  if (variables.length === 0) return "";

  const { activeTheme } = useThemeStore.getState();
  const declarations: string[] = [];
  for (const v of variables) {
    if (variableIds && !variableIds.has(v.id)) continue;
    declarations.push(`${v.name}: ${getVariableValue(v, activeTheme)};`);
  }
  if (declarations.length === 0) return "";

  return `<style>:root { ${declarations.join(" ")} }</style>`;
}
