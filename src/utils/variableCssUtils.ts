import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { getVariableValue } from "@/types/variable";
import type { ThemeName } from "@/types/variable";

/**
 * Build a `<style>:root { ... }</style>` block with current variable values.
 *
 * @param variableIds - If provided, only include variables with these IDs.
 *                      If omitted, include all variables.
 * @param theme - If provided, use this theme instead of the global active theme.
 */
export function buildVariableStyleBlock(variableIds?: Set<string>, theme?: ThemeName): string {
  const { variables } = useVariableStore.getState();
  if (variables.length === 0) return "";

  const activeTheme = theme ?? useThemeStore.getState().activeTheme;
  const declarations: string[] = [];
  for (const v of variables) {
    if (variableIds && !variableIds.has(v.id)) continue;
    declarations.push(`${v.name}: ${getVariableValue(v, activeTheme)};`);
  }
  if (declarations.length === 0) return "";

  return `<style>:root { ${declarations.join(" ")} }</style>`;
}
