import { getVariableCssName, type ModeContext, type Variable } from "@/types/variable";
import { resolveVariable, type VariableIndex } from "@/lib/variables";
import { parseCss, rootSelector, type CssNode } from "@/lib/embedComponents/css";
import type { ParsedMaster } from "@/lib/embedComponents";
import { parseEmbedHtml } from "@/lib/embedHtmlDocument";
import { MAX_TOKEN_USES, type ComponentTokenUse } from "./types";

/** Index just past the `)` that closes the `(` at `open` (or text.length). */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === "\\") i++;
    } else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i + 1;
  }
  return text.length;
}

/** Split on the first top-level comma only: `--x, a, b` -> [`--x`, `a, b`]. */
function splitFirstComma(text: string): [string, string | null] {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
  }
  return [text.trim(), null];
}

interface VarRef {
  name: string;
  fallback: string | null;
}

/** Every `var(--x[, fallback])` in `value`, outer references before the ones in their fallback. */
function findVarRefs(value: string): VarRef[] {
  const out: VarRef[] = [];
  const re = /var\(/g;
  for (let m = re.exec(value); m; m = re.exec(value)) {
    const open = m.index + 3;
    const end = closingParen(value, open);
    const [name, fallback] = splitFirstComma(value.slice(open + 1, end - 1));
    if (name.startsWith("--")) out.push({ name, fallback });
    // Keep scanning INSIDE the parens: a nested var() is a use of its own.
  }
  return out;
}

/** Declarations of a rule body (or an inline `style` value), split on top-level `;`. */
function declarations(body: string): { property: string; value: string }[] {
  const out: { property: string; value: string }[] = [];
  let depth = 0;
  let start = 0;
  const flush = (end: number) => {
    const decl = body.slice(start, end);
    const colon = decl.indexOf(":");
    if (colon > 0) out.push({ property: decl.slice(0, colon).trim().toLowerCase(), value: decl.slice(colon + 1).trim() });
    start = end + 1;
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"' || ch === "'") {
      for (i++; i < body.length && body[i] !== ch; i++) if (body[i] === "\\") i++;
    } else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) flush(i);
  }
  flush(body.length);
  return out;
}

interface RawUse {
  selector: string;
  property: string;
  ref: VarRef;
}

function collectFromCss(nodes: CssNode[], prefix: string[], out: RawUse[]): void {
  for (const node of nodes) {
    if (node.kind === "group") {
      collectFromCss(node.children, [...prefix, node.prelude.replace(/\s+/g, " ")], out);
    } else if (node.kind === "rule") {
      const selector = [...prefix, node.selectors.join(", ")].join(" ");
      for (const { property, value } of declarations(node.body)) {
        for (const ref of findVarRefs(value)) out.push({ selector, property, ref });
      }
    }
  }
}

function collectInline(rootHtml: string, key: string, out: RawUse[]): void {
  const doc = parseEmbedHtml(rootHtml);
  if (!doc) return;
  const root = doc.body.firstElementChild;
  for (const el of Array.from(doc.body.querySelectorAll("[style]"))) {
    const selector = el === root ? rootSelector(key) : `${el.tagName.toLowerCase()}[style]`;
    for (const { property, value } of declarations(el.getAttribute("style") ?? "")) {
      for (const ref of findVarRefs(value)) out.push({ selector, property, ref });
    }
  }
}

const MAX_FALLBACK_DEPTH = 8;

// `parseMaster` returns the same object for an unchanged master, so both caches
// live exactly as long as the master text and the variables array do.
const lookupCache = new WeakMap<Variable[], Map<string, Variable>>();
const usesCache = new WeakMap<ParsedMaster, RawUse[]>();

/** First variable per CSS custom-property name. Built once per variables array. */
function cssNameLookup(variables: Variable[]): Map<string, Variable> {
  const cached = lookupCache.get(variables);
  if (cached) return cached;
  const byCssName = new Map<string, Variable>();
  for (const v of variables) {
    const name = getVariableCssName(v);
    if (!byCssName.has(name)) byCssName.set(name, v);
  }
  lookupCache.set(variables, byCssName);
  return byCssName;
}

/** Every var() use in the master (stylesheet and inline styles), independent of the mode context. */
function rawUses(parsed: ParsedMaster): RawUse[] {
  const cached = usesCache.get(parsed);
  if (cached) return cached;
  const raw: RawUse[] = [];
  collectFromCss(parseCss(parsed.css), [], raw);
  collectInline(parsed.rootHtml, parsed.key, raw);
  usesCache.set(parsed, raw);
  return raw;
}

/**
 * Every design-token reference in a component master, resolved under `ctx`.
 * Scans the scoped stylesheet (base rules, `:hover` and other pseudo rules,
 * rules nested in `@media` / `@supports` / `@layer` / `@container`) and the
 * inline `style` attributes of the master HTML. A use is listed once per
 * (selector, property, token), in document order, at most `max` of them.
 * `resolved` is the variable's value under `ctx`; a name that is no variable
 * resolves through its CSS fallback, else it is null.
 */
export function componentTokens(
  parsed: ParsedMaster,
  variables: Variable[],
  index: VariableIndex,
  ctx: ModeContext,
  max: number = MAX_TOKEN_USES,
): ComponentTokenUse[] {
  const byCssName = cssNameLookup(variables);

  const resolveRef = (ref: VarRef, depth = 0): string | null => {
    const variable = byCssName.get(ref.name);
    if (variable) {
      const result = resolveVariable(index, variable.id, ctx);
      if (result.ok) return result.value;
    }
    if (ref.fallback === null || depth >= MAX_FALLBACK_DEPTH) return null;
    const inner = findVarRefs(ref.fallback);
    // A fallback that is itself one `var(...)` resolves through it.
    if (inner.length > 0 && /^var\(/.test(ref.fallback) && closingParen(ref.fallback, 3) === ref.fallback.length) {
      return resolveRef(inner[0], depth + 1);
    }
    return ref.fallback;
  };

  const raw = rawUses(parsed);

  const seen = new Set<string>();
  const out: ComponentTokenUse[] = [];
  for (const use of raw) {
    const id = `${use.selector}\u0000${use.property}\u0000${use.ref.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ selector: use.selector, property: use.property, token: use.ref.name, resolved: resolveRef(use.ref) });
    if (out.length >= max) break;
  }
  return out;
}
