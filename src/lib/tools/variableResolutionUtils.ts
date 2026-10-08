import { useVariableStore } from "@/store/variableStore";
import type { ModeInput } from "@/types/variable";
import { getVariableIndex, getVariableValueAt } from "@/lib/variables";

export function normalizeVariableRefName(name: string): string {
  return name.trim().replace(/^\$/, "");
}

function canonicalizeVariableToken(name: string): string {
  return name
    .trim()
    .replace(/^\$/, "")
    .replace(/^--/, "")
    .replace(/_/g, "-")
    .toLowerCase();
}

export function resolveVariableReference(
  value: unknown,
  theme?: ModeInput,
): { variableId: string; variableValue: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("$")) return null;

  const referenceName = normalizeVariableRefName(trimmed);
  const referenceCanonical = canonicalizeVariableToken(trimmed);
  if (!referenceName) return null;

  const { variables, collections } = useVariableStore.getState();
  const effectiveTheme = theme ?? 'light';

  const variable = variables.find((v) => {
    const normalizedVarName = normalizeVariableRefName(v.name);
    const varIdCanonical = canonicalizeVariableToken(v.id);
    const varNameCanonical = canonicalizeVariableToken(v.name);
    const normalizedNameCanonical = canonicalizeVariableToken(normalizedVarName);
    return (
      v.name === trimmed ||
      v.name === referenceName ||
      normalizedVarName === referenceName ||
      v.id === referenceName ||
      varIdCanonical === referenceCanonical ||
      varNameCanonical === referenceCanonical ||
      normalizedNameCanonical === referenceCanonical
    );
  });

  if (!variable) return null;

  return {
    variableId: variable.id,
    variableValue: getVariableValueAt(variable, effectiveTheme, getVariableIndex(variables, collections)),
  };
}
