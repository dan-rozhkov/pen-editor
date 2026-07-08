import { useVariableStore } from "@/store/variableStore";
import { generateVariableId } from "@/types/variable";
import type { Variable } from "@/types/variable";
import type { ToolHandler } from "../toolRegistry";

function normalizeVariableName(name: unknown): string {
  if (typeof name !== "string") return "Untitled";
  const normalized = name.trim().replace(/^\$/, "");
  return normalized || "Untitled";
}

function isVariableDefinition(obj: Record<string, unknown>): boolean {
  return (
    "type" in obj ||
    "$type" in obj ||
    "value" in obj ||
    "$value" in obj ||
    "color" in obj ||
    "$color" in obj ||
    "themeValues" in obj ||
    "$themeValues" in obj
  );
}

// Infer a variable type from a bare string value so the intuitive shorthand
// `{ "--brand": "#3b82f6" }` / `{ "--radius": "16" }` works without the caller
// having to spell out `{type, value}`.
function inferTypeFromValue(value: string): Variable["type"] {
  const v = value.trim();
  if (/^(#|rgb|hsl|\$)/i.test(v)) return "color";
  if (v !== "" && !Number.isNaN(Number(v))) return "number";
  return "string";
}

function extractVariablesFromObject(
  obj: Record<string, unknown>,
  parentKeys: string[] = []
): Variable[] {
  const extracted: Variable[] = [];

  for (const [key, val] of Object.entries(obj)) {
    const path = [...parentKeys, key];
    const leafName = path[path.length - 1];

    // Shorthand: a bare string maps a name straight to a value, e.g.
    // `{ "--brand-primary": "#3b82f6", "--radius-lg": "16" }`.
    if (typeof val === "string") {
      extracted.push(
        normalizeVariable({
          name: leafName,
          type: inferTypeFromValue(val),
          value: val,
        })
      );
      continue;
    }

    if (!val || typeof val !== "object" || Array.isArray(val)) continue;

    const entry = val as Record<string, unknown>;

    if (isVariableDefinition(entry)) {
      extracted.push(
        normalizeVariable({
          name: entry.name ?? leafName,
          ...entry,
        })
      );
      continue;
    }

    extracted.push(...extractVariablesFromObject(entry, path));
  }

  return extracted;
}

export const setVariables: ToolHandler = async (args) => {
  const incoming = args.variables as Record<string, unknown> | undefined;
  const replace = (args.replace as boolean) ?? false;

  if (!incoming) {
    return JSON.stringify({ error: "No variables provided" });
  }

  // Parse incoming variables — accept either an array or an object with variable entries
  const parsed: Variable[] = [];

  const normalizedIncoming =
    typeof incoming === "object" &&
    incoming &&
    !Array.isArray(incoming) &&
    typeof incoming.variables === "object" &&
    incoming.variables !== null &&
    !Array.isArray(incoming.variables)
      ? (incoming.variables as Record<string, unknown>)
      : incoming;

  if (Array.isArray(normalizedIncoming)) {
    for (const v of normalizedIncoming) {
      parsed.push(normalizeVariable(v as Record<string, unknown>));
    }
  } else if (
    typeof normalizedIncoming === "object" &&
    normalizedIncoming !== null &&
    !Array.isArray(normalizedIncoming)
  ) {
    // Supports:
    // 1) { varName: { type/value/... } }
    // 2) nested token groups, e.g. { colors: { "background-primary": { "$type": "color", "$value": "#fff" } } }
    parsed.push(...extractVariablesFromObject(normalizedIncoming));
  }

  if (parsed.length === 0) {
    return JSON.stringify({ error: "No valid variables found in input" });
  }

  const store = useVariableStore.getState();

  if (replace) {
    store.setVariables(parsed);
  } else {
    // Merge: match by id or name, update matched, append new
    const existing = [...store.variables];
    const existingByName = new Map(
      existing.map((v) => [normalizeVariableName(v.name), v])
    );
    const existingById = new Map(existing.map((v) => [v.id, v]));

    const merged: Variable[] = [...existing];

    for (const v of parsed) {
      const matchById = existingById.get(v.id);
      const matchByName = existingByName.get(normalizeVariableName(v.name));
      const match = matchById ?? matchByName;

      if (match) {
        // Update existing
        const idx = merged.indexOf(match);
        merged[idx] = { ...match, ...v, id: match.id };
      } else {
        merged.push(v);
      }
    }

    store.setVariables(merged);
  }

  return JSON.stringify({
    success: true,
    variableCount: useVariableStore.getState().variables.length,
  });
};

function normalizeVariable(obj: Record<string, unknown>): Variable {
  const type = ((obj.type ?? obj.$type) as Variable["type"]) || "color";
  const rawValue = obj.value ?? obj.$value ?? obj.color ?? obj.$color;
  const value =
    typeof rawValue === "string"
      ? rawValue
      : type === "number"
      ? "0"
      : type === "string"
      ? ""
      : "#000000";

  const rawThemeValues = (obj.themeValues ?? obj.$themeValues) as
    | Variable["themeValues"]
    | undefined;

  const themeValues =
    rawThemeValues && typeof rawThemeValues === "object"
      ? rawThemeValues
      : undefined;

  return {
    id: (obj.id as string) || generateVariableId(),
    name: normalizeVariableName(obj.name),
    type,
    value,
    themeValues,
  };
}
