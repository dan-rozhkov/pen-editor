// src/lib/designTokens/cssTokens.ts
//
// Shared planning for the CSS-flavoured exports (`toCss`, `toTailwindTheme`):
// one default-mode declaration per variable, one override block per non-default
// mode, aliases as `var(--target)`.
import {
  THEME_COLLECTION_ID,
  getVariableCssName,
  type Variable,
  type VariableCollection,
  type VariableModeValue,
} from "@/types/variable";
import { buildVariableIndex, collectionIdOf, modeValuesOf } from "@/lib/variables";

export interface CssTokenInput {
  variables: Variable[];
  /** Omit for a legacy document: only the Theme collection (light/dark) exists then. */
  collections?: VariableCollection[];
}

export interface CssDecl {
  variable: Variable;
  /** The custom property name, `--x`. */
  name: string;
  value: string;
}

export interface CssModeBlock {
  /** e.g. `[data-theme="dark"]` */
  selector: string;
  collectionId: string;
  modeId: string;
  decls: CssDecl[];
}

export interface CssPlan {
  defaults: CssDecl[];
  modes: CssModeBlock[];
  warnings: string[];
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Make a value safe to put after `--x:`. Plain values pass through; anything
 * holding `;`, braces, a quote, a backslash or a line break becomes a quoted CSS string.
 */
export function cssValue(raw: string): string {
  if (!/[;{}"\\\n\r]/.test(raw)) return raw;
  const escaped = raw
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n|\r/g, "\\a ");
  return `"${escaped}"`;
}

/** Add `px` to a bare non-zero number (`8` -> `8px`); anything else, and `0`, is kept. */
export function withPx(raw: string): string {
  const t = raw.trim();
  return /^-?(\d+\.?\d*|\.\d+)$/.test(t) && Number(t) !== 0 ? `${t}px` : raw;
}

/** A number variable whose scopes say it is a length (not opacity, weight or unscoped). */
export function isLengthScoped(v: Variable): boolean {
  if (v.type !== "number") return false;
  const scopes = v.scopes ?? [];
  if (scopes.includes("opacity") || scopes.includes("fontWeight")) return false;
  return scopes.some((s) => ["radius", "spacing", "gap", "size", "fontSize", "strokeWidth"].includes(s));
}

export interface PlanOptions {
  /** Whether a number variable is a length and so is written with `px`. Default: `isLengthScoped`. */
  isLength?: (v: Variable) => boolean;
  /** Custom-property name for a variable; defaults to `getVariableCssName`. */
  nameOf?: (v: Variable) => string;
}

export function planCssTokens(input: CssTokenInput, options: PlanOptions = {}): CssPlan {
  const warnings: string[] = [];
  const index = buildVariableIndex(input.variables, input.collections);
  const baseName = options.nameOf ?? getVariableCssName;
  const isLength = options.isLength ?? isLengthScoped;

  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const v of input.variables) {
    let name = baseName(v);
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${name}-${n}`)) n++;
      warnings.push(`Variable "${v.name}" maps to ${name}, already taken; exported as ${name}-${n}.`);
      name = `${name}-${n}`;
    }
    used.add(name);
    names.set(v.id, name);
  }

  const emit = (v: Variable, entry: VariableModeValue): string => {
    if (typeof entry === "string") return cssValue(isLength(v) ? withPx(entry) : entry);
    const target = names.get(entry.alias);
    if (target) return `var(${target})`;
    warnings.push(`Variable "${v.name}" aliases a deleted variable; wrote its resolved value.`);
    return cssValue(isLength(v) ? withPx(v.value) : v.value);
  };

  const defaults: CssDecl[] = [];
  const modes: CssModeBlock[] = [];
  const usedSelectors = new Set<string>();
  const defaultById = new Map<string, CssDecl>();
  const varsByCollection = new Map<string, Variable[]>();
  for (const v of input.variables) {
    const cid = collectionIdOf(v);
    const list = varsByCollection.get(cid);
    if (list) list.push(v);
    else varsByCollection.set(cid, [v]);
  }
  for (const collection of index.collections.values()) {
    const vars = varsByCollection.get(collection.id) ?? [];
    if (vars.length === 0) continue;
    const attr = collection.id === THEME_COLLECTION_ID ? "theme" : slugify(collection.name) || slugify(collection.id);
    for (const v of vars) {
      const entry = modeValuesOf(v)[collection.defaultModeId];
      const fallback = entry ?? Object.values(modeValuesOf(v))[0] ?? v.value;
      const decl: CssDecl = { variable: v, name: names.get(v.id) as string, value: emit(v, fallback) };
      defaults.push(decl);
      defaultById.set(v.id, decl);
    }
    for (const mode of collection.modes) {
      if (mode.id === collection.defaultModeId) continue;
      const modeSlug =
        (collection.id === THEME_COLLECTION_ID && /^[a-z0-9-]+$/.test(mode.id) ? mode.id : slugify(mode.name)) ||
        slugify(mode.id);
      let selector = `[data-${attr}="${modeSlug}"]`;
      for (let n = 2; usedSelectors.has(selector); n++) selector = `[data-${attr}="${modeSlug}-${n}"]`;
      usedSelectors.add(selector);
      const decls: CssDecl[] = [];
      for (const v of vars) {
        const own = modeValuesOf(v)[mode.id];
        if (own === undefined) continue; // falls back to the default
        const value = emit(v, own);
        const def = defaultById.get(v.id);
        if (def?.value === value) continue;
        decls.push({ variable: v, name: names.get(v.id) as string, value });
      }
      if (decls.length > 0) modes.push({ selector, collectionId: collection.id, modeId: mode.id, decls });
    }
  }
  return { defaults, modes, warnings };
}

export function formatDecls(decls: CssDecl[], indent: string): string {
  return decls.map((d) => `${indent}${d.name}: ${d.value};`).join("\n");
}
