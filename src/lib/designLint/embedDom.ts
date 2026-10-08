import { parseCss, type CssNode } from "@/lib/embedComponents/css";
import { parseColor } from "./colorMath";

/**
 * DOM and CSS plumbing for the embed lint rules: declaration parsing, style
 * rule collection, managed-zone detection, element paths and a limited
 * cascade. Pure apart from reading the `Document`/`Element` it is given.
 */

export interface Decl {
  property: string;
  value: string;
}

export interface StyleRule {
  selectors: string[];
  decls: Decl[];
  /** Position of the rule in the document (cascade order). */
  order: number;
  /** Inside a conditional at-rule (`@media`, `@supports`...): not part of the limited cascade. */
  conditional: boolean;
  /** `style[i] selector` style label for messages and ids. */
  label: string;
}

/** Split a declaration block on top-level `;`, honoring parentheses and quotes. */
export function parseDeclarations(body: string): Decl[] {
  const out: Decl[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  const flush = (end: number) => {
    const chunk = body.slice(start, end);
    const colon = chunk.indexOf(":");
    if (colon > 0) {
      const property = chunk.slice(0, colon).trim().toLowerCase();
      const value = chunk.slice(colon + 1).replace(/!important\s*$/i, "").trim();
      if (property && value) out.push({ property, value });
    }
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      flush(i);
      start = i + 1;
    }
  }
  flush(body.length);
  return out;
}

function walkRules(nodes: CssNode[], conditional: boolean, visit: (r: Extract<CssNode, { kind: "rule" }>, conditional: boolean) => void): void {
  for (const node of nodes) {
    if (node.kind === "rule") visit(node, conditional);
    else if (node.kind === "group") walkRules(node.children, conditional || /^@(media|supports|container)/i.test(node.prelude), visit);
  }
}

/** Every style rule of the document's own `<style>` blocks (managed `data-c-style` copies excluded). */
export function collectStyleRules(doc: Document): StyleRule[] {
  const rules: StyleRule[] = [];
  const styles = Array.from(doc.querySelectorAll("style")).filter((s) => !s.hasAttribute("data-c-style"));
  styles.forEach((style, index) => {
    walkRules(parseCss(style.textContent ?? ""), false, (rule, conditional) => {
      rules.push({
        selectors: rule.selectors,
        decls: parseDeclarations(rule.body),
        order: rules.length,
        conditional,
        label: `style[${index}] ${rule.selectors.join(", ")}`,
      });
    });
  });
  return rules;
}

/** `body > div:nth-of-type(2) > span`. */
export function elementPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName !== "HTML") {
    const tag = cur.tagName.toLowerCase();
    if (tag === "body") {
      parts.unshift("body");
      break;
    }
    const parent: Element | null = cur.parentElement;
    const same = parent ? Array.from(parent.children).filter((c) => c.tagName === cur!.tagName) : [];
    parts.unshift(same.length > 1 && parent ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
    cur = parent;
  }
  return parts.join(" > ");
}

/**
 * Is `el` inside the managed zone of a component region (rendered from the
 * master, so its literals belong to the master)? Slot content is owned by the
 * instance. A master embed's own root region is not managed from its own point
 * of view.
 */
export function inManagedZone(el: Element, masterKey?: string): boolean {
  let region = el.closest("[data-c]");
  while (region) {
    const ownRoot = masterKey !== undefined && region.getAttribute("data-c") === masterKey;
    const slot = el.closest("[data-c-slot]");
    const inOwnSlot = !!slot && region.contains(slot) && slot.closest("[data-c]") === region && slot !== region;
    if (!ownRoot && !inOwnSlot) return true;
    region = region.parentElement?.closest("[data-c]") ?? null;
  }
  return false;
}

const COLOR_PROPERTY = /^(?:color|background|fill|stroke|box-shadow|text-shadow|border(?:-[a-z]+)*|outline(?:-[a-z]+)*)$|-color$/;
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\([^()]*\)/gi;

export function isColorProperty(property: string): boolean {
  return !property.startsWith("--") && COLOR_PROPERTY.test(property);
}

/** `value` without any `var(...)` call (balanced), so literals in fallbacks are not reported. */
function stripVarCalls(value: string): string {
  let out = "";
  let i = 0;
  while (i < value.length) {
    if (value.slice(i, i + 4).toLowerCase() === "var(") {
      let depth = 1;
      i += 4;
      while (i < value.length && depth > 0) {
        if (value[i] === "(") depth++;
        else if (value[i] === ")") depth--;
        i++;
      }
      out += " ";
    } else out += value[i++];
  }
  return out;
}

/** Color literals in a declaration value; a bare named color counts when it is the whole value. */
export function colorLiterals(property: string, value: string): string[] {
  if (!isColorProperty(property)) return [];
  const bare = stripVarCalls(value);
  const matches = bare.match(COLOR_LITERAL);
  if (matches) return [...new Set(matches.map((m) => m.trim()))].filter((m) => parseColor(m) !== null);
  const whole = bare.trim();
  return whole && parseColor(whole) && whole.toLowerCase() !== "transparent" ? [whole] : [];
}

const LENGTH_PROPERTIES: Array<[RegExp, "radius" | "spacing" | "fontSize"]> = [
  [/^border(?:-[a-z]+)*-radius$/, "radius"],
  [/^(?:padding|margin)(?:-[a-z]+)?$/, "spacing"],
  [/^(?:gap|row-gap|column-gap)$/, "spacing"],
  [/^font-size$/, "fontSize"],
];

/** A whole-value `Npx` length (not zero) on a token-worthy property, as `{scope, px}`. */
export function pxLiteral(property: string, value: string): { scope: "radius" | "spacing" | "fontSize"; px: number } | null {
  const m = /^(-?\d+(?:\.\d+)?)px$/i.exec(value.trim());
  if (!m) return null;
  const px = Number(m[1]);
  if (px === 0) return null;
  const hit = LENGTH_PROPERTIES.find(([re]) => re.test(property));
  return hit ? { scope: hit[1], px } : null;
}

// ---------------------------------------------------------------------------
// Limited cascade
// ---------------------------------------------------------------------------

function specificity(selector: string): number {
  const s = selector.replace(/:(?:not|is|where|has)\(([^)]*)\)/g, " $1 ");
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const tags = (s.replace(/\[[^\]]*\]|[.#:][\w-]+/g, " ").match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return ids * 10000 + classes * 100 + tags;
}

export function parseInlineStyle(el: Element): Decl[] {
  const raw = el.getAttribute("style");
  return raw ? parseDeclarations(raw) : [];
}

/**
 * The declarations that apply to one element: unconditional rules by
 * (specificity, order), then the inline style. Not a full cascade — no
 * `!important`, no inheritance, no media queries — so callers read it as
 * "declared on this element".
 */
export class LimitedCascade {
  private readonly cache = new Map<Element, Map<string, string>>();

  private readonly rules: StyleRule[];

  constructor(rules: StyleRule[]) {
    this.rules = rules;
  }

  declared(el: Element): Map<string, string> {
    const hit = this.cache.get(el);
    if (hit) return hit;
    const matched: Array<{ spec: number; order: number; decls: Decl[] }> = [];
    for (const rule of this.rules) {
      if (rule.conditional) continue;
      let best = -1;
      for (const sel of rule.selectors) {
        try {
          if (el.matches(sel)) best = Math.max(best, specificity(sel));
        } catch {
          /* unsupported selector: treated as not matching */
        }
      }
      if (best >= 0) matched.push({ spec: best, order: rule.order, decls: rule.decls });
    }
    matched.sort((a, b) => a.spec - b.spec || a.order - b.order);
    const out = new Map<string, string>();
    for (const m of matched) for (const d of m.decls) out.set(d.property, d.value);
    for (const d of parseInlineStyle(el)) out.set(d.property, d.value);
    this.cache.set(el, out);
    return out;
  }
}
