import { parseColor, toHex } from "@/lib/designLint/colorMath";

// Pure converter: the design tokens a repo brief carries (backend
// `DesignTokens`, pen-editor-backend/src/services/repoDesignSystem.ts) ->
// `set_variables`-shaped arguments. Nothing here touches a store; the planner
// (planRepoImport.ts) decides what can actually be applied.

export interface RepoDesignTokens {
  colors?: Record<string, string>;
  fontFamily?: Record<string, string>;
  spacing?: Record<string, string>;
  borderRadius?: Record<string, string>;
  boxShadow?: Record<string, string>;
  dark?: { colors?: Record<string, string> };
}

export const PRIMITIVES_COLLECTION = "Primitives";
export const THEME_COLLECTION_NAME = "Theme";

export interface ImportVariableDef {
  name: string;
  type: "color" | "number" | "string";
  collection: string;
  value?: string;
  valuesByMode?: Record<string, string>;
  description?: string;
}

export interface SetVariablesArgs {
  collections: Record<string, { modes: string[] }>;
  variables: ImportVariableDef[];
}

export type ImportCategory = "colors" | "spacing" | "borderRadius" | "fontFamily" | "themeAliases";

export interface TokenConversion {
  args: SetVariablesArgs;
  counts: Record<ImportCategory, number>;
  /** Tokens left out, and tokens kept with a caveat. */
  notes: string[];
}

export interface ConvertOptions {
  /** Modes of an existing local Primitives collection; used when the repo has no dark tokens. */
  existingPrimitivesModes?: string[];
}

const LIGHT = "Light";
const DARK = "Dark";
const REM_PX = 16;

const SEMANTIC_ROLES = [
  "background", "foreground", "card", "popover", "primary", "secondary", "muted",
  "accent", "destructive", "success", "warning", "info", "danger", "error", "surface",
];
const SEMANTIC_EXACT = new Set<string>([
  ...SEMANTIC_ROLES,
  ...SEMANTIC_ROLES.map((r) => `${r}-foreground`),
  "border", "input", "ring",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
  "sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground",
  "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring",
]);

/** `primary.DEFAULT` -> `primary`, `Primary.500` -> `primary-500`. */
function normalizeKey(key: string): string {
  const parts = key.split(".").filter(Boolean);
  if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === "default") parts.pop();
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function colorValue(raw: string): string | null {
  const parsed = parseColor(raw);
  return parsed ? toHex(parsed) : null;
}

type Length = { kind: "number"; value: string } | { kind: "string"; value: string; why: string };

/** px stays, rem x 16, unitless numbers stay; em, % and anything else stay strings. */
function parseLength(raw: string): Length {
  const v = raw.trim();
  const m = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem)?$/i.exec(v);
  if (m) {
    const n = Number(m[1]) * (m[2]?.toLowerCase() === "rem" ? REM_PX : 1);
    return { kind: "number", value: String(Math.round(n * 1000) / 1000) };
  }
  if (/^-?[\d.]+\s*(em|%)$/i.test(v)) return { kind: "string", value: v, why: "relative unit kept as a string" };
  return { kind: "string", value: v, why: "not a plain length, kept as a string" };
}

/** `-dark`, then `-on-dark`, then numbered; never a name a real token owns or one already used. */
function freeDarkName(base: string, reserved: Set<string>, taken: Set<string>): string {
  const free = (n: string): boolean => !reserved.has(n) && !taken.has(n);
  for (const suffix of ["-dark", "-on-dark"]) if (free(base + suffix)) return base + suffix;
  for (let i = 2; ; i++) if (free(`${base}-on-dark-${i}`)) return `${base}-on-dark-${i}`;
}

export function convertDesignTokens(tokens: RepoDesignTokens, options: ConvertOptions = {}): TokenConversion {
  const notes: string[] = [];
  const counts: Record<ImportCategory, number> = {
    colors: 0, spacing: 0, borderRadius: 0, fontFamily: 0, themeAliases: 0,
  };
  const darkColors = tokens.dark?.colors ?? {};
  const existingModes = options.existingPrimitivesModes ?? [];
  const primitiveModes = existingModes.length > 0 ? existingModes : ["Default"];
  if (existingModes.length > 1) {
    notes.push(`Primitives has several modes (${existingModes.join(", ")}); the import writes its default mode only.`);
  }

  const variables: ImportVariableDef[] = [];
  const aliases: ImportVariableDef[] = [];
  const taken = new Set<string>();

  const claim = (name: string, source: string): boolean => {
    if (taken.has(name)) {
      notes.push(`${source}: skipped, ${name} is already taken by another token.`);
      return false;
    }
    taken.add(name);
    return true;
  };

  // Colors: light (or only) values first, then dark-only keys.
  const colorKeys = new Map<string, { light?: string; dark?: string; label: string }>();
  const merge = (key: string, raw: string, side: "light" | "dark"): void => {
    const norm = normalizeKey(key);
    if (!norm) return;
    const prev = colorKeys.get(norm);
    if (prev && prev[side] !== undefined) {
      notes.push(`colors.${key}${side === "dark" ? " (dark)" : ""} and colors.${prev.label} both become --color-${norm}; the later one (${key}) wins.`);
    }
    colorKeys.set(norm, { ...prev, [side]: raw, label: prev?.label ?? key });
  };
  for (const [key, raw] of Object.entries(tokens.colors ?? {})) merge(key, raw, "light");
  for (const [key, raw] of Object.entries(darkColors)) merge(key, raw, "dark");
  // Every real color name is reserved up front, so a generated "-dark" primitive can never take one.
  const reserved = new Set([...colorKeys.keys()].map((n) => `--color-${n}`));
  for (const [norm, entry] of colorKeys) {
    const light = entry.light !== undefined ? colorValue(entry.light) : null;
    const dark = entry.dark !== undefined ? colorValue(entry.dark) : null;
    if (entry.light !== undefined && light === null) {
      notes.push(`colors.${entry.label}: skipped, "${entry.light}" is not a literal color.`);
      continue;
    }
    if (entry.dark !== undefined && dark === null) {
      notes.push(`colors.${entry.label} (dark): "${entry.dark}" is not a literal color; the light value is used for Dark.`);
    }
    const lightValue = light ?? dark;
    if (lightValue === null) continue;
    if (light === null) notes.push(`colors.${entry.label}: only defined for dark; the base primitive holds the dark value.`);
    const name = `--color-${norm}`;
    if (!claim(name, `colors.${entry.label}`)) continue;
    variables.push({ name, type: "color", collection: PRIMITIVES_COLLECTION, value: lightValue });
    counts.colors++;
    // Theme dark must work on its own: a differing dark value gets its own primitive.
    let darkName = name;
    if (light !== null && dark !== null && dark !== light) {
      const candidate = freeDarkName(name, reserved, taken);
      if (candidate !== `${name}-dark`) {
        notes.push(`colors.${entry.label}: --color-${norm}-dark is a real token, so the dark value is named ${candidate}.`);
      }
      if (claim(candidate, `colors.${entry.label} (dark)`)) {
        variables.push({ name: candidate, type: "color", collection: PRIMITIVES_COLLECTION, value: dark });
        counts.colors++;
        darkName = candidate;
      }
    }
    if (SEMANTIC_EXACT.has(norm)) {
      aliases.push({
        name: `--${norm}`,
        type: "color",
        collection: THEME_COLLECTION_NAME,
        valuesByMode: { [LIGHT]: `$${name}`, [DARK]: `$${darkName}` },
        description: `Alias of ${name} (imported from repo)`,
      });
      counts.themeAliases++;
    }
  }

  const lengths = (
    category: "spacing" | "borderRadius",
    prefix: string,
  ): void => {
    for (const [key, raw] of Object.entries(tokens[category] ?? {})) {
      const norm = normalizeKey(key) || "default";
      const name = `${prefix}-${norm}`;
      const len = parseLength(raw);
      if (len.kind === "string") notes.push(`${category}.${key}: "${raw}" ${len.why}.`);
      if (!claim(name, `${category}.${key}`)) continue;
      variables.push({ name, type: len.kind, collection: PRIMITIVES_COLLECTION, value: len.value });
      counts[category]++;
    }
  };
  lengths("spacing", "--space");
  lengths("borderRadius", "--radius");

  for (const [key, raw] of Object.entries(tokens.fontFamily ?? {})) {
    const norm = normalizeKey(key) || "default";
    const name = `--font-${norm}`;
    if (!claim(name, `fontFamily.${key}`)) continue;
    variables.push({ name, type: "string", collection: PRIMITIVES_COLLECTION, value: raw.trim() });
    counts.fontFamily++;
  }

  const shadows = Object.keys(tokens.boxShadow ?? {}).length;
  if (shadows > 0) notes.push(`boxShadow: ${shadows} shadow token(s) skipped; variables cannot hold shadows.`);

  return {
    args: {
      collections: { [PRIMITIVES_COLLECTION]: { modes: primitiveModes } },
      variables: [...variables, ...aliases],
    },
    counts,
    notes,
  };
}
