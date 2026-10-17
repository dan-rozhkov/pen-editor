export type VariableType = 'color' | 'number' | 'string'
export type ThemeName = 'light' | 'dark'

export interface ThemeValues {
  light: string
  dark: string
}

export interface Variable {
  id: string
  name: string
  type: VariableType
  value: string // hex color "#RRGGBB" - kept for backward compat
  themeValues?: ThemeValues
}

export function generateVariableId(): string {
  return 'var_' + Math.random().toString(36).substring(2, 9)
}

// Get the effective value for a specific theme
export function getVariableValue(variable: Variable, theme: ThemeName): string {
  if (variable.themeValues) {
    return variable.themeValues[theme]
  }
  return variable.value
}

/**
 * The CSS custom-property name a `Variable` resolves to when it is written
 * into or matched against actual CSS (a `<style>:root{...}</style>` block,
 * an inline `root.style.setProperty(...)`, or a `var(--x)` reference).
 *
 * `Variable.name` is a free-form label, NOT a CSS identifier: the Variables
 * panel's `handleAddVariable` (`src/components/VariablesPanel.tsx`) creates
 * variables literally named `"Color 1"`, `"Number 2"`, while an imported or
 * AI-authored document typically already carries a `--`-prefixed name like
 * `"--brand-500"`. A CSS custom property MUST start with `--` and cannot
 * contain a space (or most other punctuation) — `root.style.setProperty("Color
 * 1", ...)` is a silent no-op, and `var(--Color 1)` is invalid CSS — so every
 * site that turns a variable into CSS must go through this one function
 * rather than using `variable.name` directly, or the mapping drifts.
 *
 * - A name that already starts with `--` is returned unchanged (only
 *   trimmed): this is the common case for imported/AI-authored documents,
 *   and must not change, or existing `var(--brand-500)` references inside
 *   already-authored HTML would stop resolving.
 * - Otherwise the name is slugified into a valid custom property: trimmed,
 *   lowercased, any run of characters outside `[a-z0-9-]` collapsed to a
 *   single `-`, leading/trailing `-` stripped, and `--` prefixed.
 * - If nothing survives the slugify (e.g. the name was all emoji/whitespace),
 *   fall back to a name derived from the variable's id — stable across calls
 *   for the same variable and unique-ish across variables, and never empty
 *   or invalid.
 *
 * KNOWN LIMITATION: embed bindings (`EmbedElementProperties.tsx`) store the
 * result of THIS function — a name — directly into `htmlContent` as
 * `var(--name)`, unlike a native node's fill/stroke, which stores
 * `variableId` and resolves the name lazily. Renaming a variable changes
 * what this function returns for it, but nothing migrates the
 * `var(--old-name)` references already written into embed HTML — they just
 * stop resolving. That's inherent to plain CSS custom properties, not a bug
 * in this function.
 */
export function getVariableCssName(variable: Pick<Variable, "id" | "name">): string {
  const trimmed = variable.name.trim();
  if (trimmed.startsWith("--")) return trimmed;

  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug ? `--${slug}` : `--var-${variable.id}`;
}

// Ensure variable has theme values (migration helper)
export function ensureThemeValues(variable: Variable): Variable {
  if (!variable.themeValues) {
    return {
      ...variable,
      themeValues: {
        light: variable.value,
        dark: variable.value,
      },
    }
  }
  return variable
}
