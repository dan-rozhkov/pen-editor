import { useVariableStore } from "@/store/variableStore";
import type { VariableScope, VariableType } from "@/types/variable";
import type { ToolHandler } from "../toolRegistry";
import {
  planVariableChanges,
  type CollectionSpec,
  type VariableEntry,
} from "./variablesPlan";
import { VARIABLE_SCOPES } from "./variableToolUtils";

const TYPES: readonly string[] = ["color", "number", "string"];

function normalizeVariableName(name: unknown): string {
  if (typeof name !== "string") return "Untitled";
  const normalized = name.trim().replace(/^\$/, "");
  return normalized || "Untitled";
}

/** Every key that marks an object as one variable definition (also with a `$` prefix). */
const DEFINITION_KEYS = [
  "id", "name", "type", "value", "color", "themeValues", "valuesByMode",
  "description", "scopes", "deprecated", "collection",
];

function isDefinitionKey(key: string): boolean {
  return DEFINITION_KEYS.includes(key.startsWith("$") ? key.slice(1) : key);
}

function isVariableDefinition(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some(isDefinitionKey);
}

// Infer a variable type from a bare string value so the intuitive shorthand
// `{ "--brand": "#3b82f6" }` / `{ "--radius": "16" }` works without the caller
// having to spell out `{type, value}`. An alias (`$--x`) has no type of its
// own: it takes its target's.
function inferTypeFromValue(value: string): VariableType | undefined {
  const v = value.trim();
  if (v.startsWith("$")) return undefined;
  if (/^(#|rgb|hsl)/i.test(v)) return "color";
  if (v !== "" && !Number.isNaN(Number(v))) return "number";
  return "string";
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function textValue(x: unknown): string | undefined {
  if (typeof x === "string") return x;
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  return undefined;
}

function parseModeMap(label: string, key: string, x: unknown, errors: string[]): Record<string, string> | undefined {
  if (x === undefined) return undefined;
  if (!isRecord(x)) {
    errors.push(`variable "${label}": \`${key}\` must be an object keyed by mode name.`);
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [mode, value] of Object.entries(x)) {
    const text = textValue(value);
    if (text === undefined) errors.push(`variable "${label}": \`${key}.${mode}\` must be a string.`);
    else out[mode] = text;
  }
  return out;
}

function parseEntry(obj: Record<string, unknown>, leafName: string | undefined, errors: string[]): VariableEntry {
  const entry: VariableEntry = {};
  if (typeof obj.id === "string" && obj.id) entry.id = obj.id;
  const rawName = obj.name ?? leafName;
  if (rawName !== undefined) entry.name = normalizeVariableName(rawName);
  const label = entry.name ?? entry.id ?? "Untitled";

  const rawType = obj.type ?? obj.$type;
  if (rawType !== undefined) {
    if (typeof rawType === "string" && TYPES.includes(rawType)) entry.type = rawType as VariableType;
    else errors.push(`variable "${label}": \`type\` must be "color", "number" or "string".`);
  }

  const rawValue = obj.value ?? obj.$value ?? obj.color ?? obj.$color;
  if (rawValue !== undefined) {
    entry.value = textValue(rawValue);
    if (entry.value === undefined) errors.push(`variable "${label}": \`value\` must be a string.`);
  }

  const themeValues = parseModeMap(label, "themeValues", obj.themeValues ?? obj.$themeValues, errors);
  const byMode = parseModeMap(label, "valuesByMode", obj.valuesByMode ?? obj.$valuesByMode, errors);
  if (themeValues || byMode) entry.modeValues = { ...themeValues, ...byMode };

  if (obj.collection !== undefined) {
    if (typeof obj.collection === "string" && obj.collection.trim()) entry.collection = obj.collection.trim();
    else errors.push(`variable "${label}": \`collection\` must be a collection name.`);
  }
  if (obj.description !== undefined) {
    if (typeof obj.description === "string") entry.description = obj.description;
    else errors.push(`variable "${label}": \`description\` must be a string.`);
  }
  if (obj.scopes !== undefined) {
    const scopes = obj.scopes;
    const bad = Array.isArray(scopes)
      ? scopes.filter((s) => !VARIABLE_SCOPES.includes(s as VariableScope))
      : [scopes];
    if (!Array.isArray(scopes) || bad.length > 0) {
      errors.push(`variable "${label}": \`scopes\` must be an array of ${VARIABLE_SCOPES.join(", ")}.`);
    } else entry.scopes = scopes as VariableScope[];
  }
  if (obj.deprecated !== undefined) {
    const d = obj.deprecated;
    if (!isRecord(d)) errors.push(`variable "${label}": \`deprecated\` must be an object {since?, replacedBy?, note?}.`);
    else {
      entry.deprecated = {};
      if (typeof d.since === "string") entry.deprecated.since = d.since;
      if (typeof d.replacedBy === "string") entry.deprecated.replacedBy = d.replacedBy;
      if (typeof d.note === "string") entry.deprecated.note = d.note;
    }
  }
  return entry;
}

function extractEntries(
  obj: Record<string, unknown>,
  errors: string[],
): VariableEntry[] {
  const extracted: VariableEntry[] = [];

  for (const [key, val] of Object.entries(obj)) {
    // A field name is never a variable name (`{ description: "x" }` next to tokens).
    if (isDefinitionKey(key)) continue;
    // Shorthand: a bare string maps a name straight to a value, e.g.
    // `{ "--brand-primary": "#3b82f6", "--radius-lg": "16" }`.
    if (typeof val === "string") {
      const entry: VariableEntry = { name: normalizeVariableName(key), value: val };
      const inferred = inferTypeFromValue(val);
      if (inferred) entry.type = inferred;
      extracted.push(entry);
      continue;
    }
    if (!isRecord(val)) continue;

    if (isVariableDefinition(val)) {
      extracted.push(parseEntry(val, key, errors));
      continue;
    }
    // Nested token groups, e.g. { colors: { "background-primary": { "$type": "color", "$value": "#fff" } } }
    extracted.push(...extractEntries(val, errors));
  }
  return extracted;
}

function parseCollectionSpecs(
  x: unknown,
  errors: string[],
): Record<string, CollectionSpec> | undefined {
  if (x === undefined) return undefined;
  if (!isRecord(x)) {
    errors.push("`collections` must be an object keyed by collection name.");
    return undefined;
  }
  const out: Record<string, CollectionSpec> = {};
  for (const [name, spec] of Object.entries(x)) {
    const modes = isRecord(spec) ? spec.modes : undefined;
    if (!Array.isArray(modes) || modes.length === 0 || !modes.every((m) => typeof m === "string" && m.trim())) {
      errors.push(`collections.${name}: \`modes\` must be a non-empty array of mode names.`);
      continue;
    }
    const defaultMode = (spec as Record<string, unknown>).defaultMode;
    out[name] = {
      modes: modes as string[],
      ...(typeof defaultMode === "string" ? { defaultMode } : {}),
    };
  }
  return out;
}

export const setVariables: ToolHandler = async (args) => {
  const incoming = args.variables as Record<string, unknown> | unknown[] | undefined;
  const replace = (args.replace as boolean) ?? false;

  if (!incoming && args.collections === undefined) {
    return JSON.stringify({ error: "No variables provided" });
  }

  const errors: string[] = [];
  const entries: VariableEntry[] = [];

  // Accept either an array or an object with variable entries (optionally
  // wrapped in `{ variables: {...} }`).
  const normalizedIncoming =
    isRecord(incoming) && isRecord(incoming.variables) ? incoming.variables : incoming;

  if (!normalizedIncoming) {
    // collections-only call
  } else if (Array.isArray(normalizedIncoming)) {
    for (const v of normalizedIncoming) {
      if (isRecord(v)) entries.push(parseEntry(v, undefined, errors));
    }
  } else if (isRecord(normalizedIncoming)) {
    entries.push(...extractEntries(normalizedIncoming, errors));
  }

  const collectionSpecs = parseCollectionSpecs(args.collections, errors);
  if (args.collection !== undefined && (typeof args.collection !== "string" || !args.collection.trim())) {
    errors.push("`collection` must be a collection name.");
  }

  if (errors.length > 0) {
    return JSON.stringify({ error: `set_variables changed nothing. ${errors.join(" ")}` });
  }
  if (entries.length === 0 && (collectionSpecs === undefined || Object.keys(collectionSpecs).length === 0)) {
    return JSON.stringify({ error: "No valid variables found in input" });
  }

  const store = useVariableStore.getState();
  const plan = planVariableChanges({
    entries,
    collectionSpecs,
    defaultCollection: typeof args.collection === "string" ? args.collection : undefined,
    replace,
    variables: store.variables,
    collections: store.collections,
  });
  if ("error" in plan) return JSON.stringify({ error: plan.error });

  store.replaceAll(plan.variables, plan.collections);

  return JSON.stringify({
    success: true,
    variableCount: useVariableStore.getState().variables.length,
    created: plan.created,
    updated: plan.updated,
    warnings: plan.warnings,
  });
};
