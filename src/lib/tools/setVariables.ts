import { useVariableStore } from "@/store/variableStore";
import { generateVariableId } from "@/types/variable";
import type { Variable } from "@/types/variable";
import type { ToolHandler } from "../toolRegistry";

export const setVariables: ToolHandler = async (args) => {
  const incoming = args.variables as Record<string, unknown> | undefined;
  const replace = (args.replace as boolean) ?? false;

  if (!incoming) {
    return JSON.stringify({ error: "No variables provided" });
  }

  // Parse incoming variables — accept either an array or an object with variable entries
  const parsed: Variable[] = [];

  if (Array.isArray(incoming)) {
    for (const v of incoming) {
      parsed.push(normalizeVariable(v as Record<string, unknown>));
    }
  } else if (typeof incoming === "object") {
    // Could be { variableName: { type, value, themeValues } } format
    for (const [key, val] of Object.entries(incoming)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const obj = val as Record<string, unknown>;
        parsed.push(
          normalizeVariable({ name: obj.name ?? key, ...obj })
        );
      }
    }
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
    const existingByName = new Map(existing.map((v) => [v.name, v]));
    const existingById = new Map(existing.map((v) => [v.id, v]));

    const merged: Variable[] = [...existing];

    for (const v of parsed) {
      const matchById = existingById.get(v.id);
      const matchByName = existingByName.get(v.name);
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
  return {
    id: (obj.id as string) || generateVariableId(),
    name: (obj.name as string) || "Untitled",
    type: (obj.type as Variable["type"]) || "color",
    value: (obj.value as string) || "#000000",
    themeValues: obj.themeValues as Variable["themeValues"],
  };
}
