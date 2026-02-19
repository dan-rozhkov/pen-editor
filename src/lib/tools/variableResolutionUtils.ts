import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { getVariableValue } from "@/types/variable";
import type { ThemeName } from "@/types/variable";

export function normalizeVariableRefName(name: string): string {
  return name.trim().replace(/^\$/, "");
}

export function resolveVariableReference(
  value: unknown,
  theme?: ThemeName,
): { variableId: string; variableValue: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("$")) return null;

  const referenceName = normalizeVariableRefName(trimmed);
  if (!referenceName) return null;

  const { variables } = useVariableStore.getState();
  const { activeTheme } = useThemeStore.getState();
  const effectiveTheme = theme ?? activeTheme;

  const variable = variables.find((v) => {
    const normalizedVarName = normalizeVariableRefName(v.name);
    return (
      v.name === trimmed ||
      v.name === referenceName ||
      normalizedVarName === referenceName
    );
  });

  if (!variable) return null;

  return {
    variableId: variable.id,
    variableValue: getVariableValue(variable, effectiveTheme),
  };
}
