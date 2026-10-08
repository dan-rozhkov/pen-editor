/**
 * Minimal CSS rule tree used to scope a component master's stylesheet to its
 * root (`[data-c="key"]`) and to lift matching rules out of a screen's own
 * stylesheet (extract_component). Not a general CSS parser: it understands
 * comments, strings, nested braces, and the grouping at-rules (`@media`,
 * `@supports`, `@layer`, `@container`); every other at-rule is carried as raw
 * text. Pure — no DOM, no stores.
 */

export type CssNode =
  | { kind: "rule"; selectors: string[]; body: string }
  | { kind: "group"; prelude: string; children: CssNode[] }
  | { kind: "raw"; text: string };

const GROUPING_AT_RULES = new Set(["media", "supports", "layer", "container", "document"]);

/** Index just past the closing quote of the string starting at `i`. */
function skipString(css: string, i: number): number {
  const quote = css[i];
  let j = i + 1;
  while (j < css.length) {
    if (css[j] === "\\") j += 2;
    else if (css[j] === quote) return j + 1;
    else j++;
  }
  return css.length;
}

/** Index just past the end of the block comment starting at `i`. */
function skipComment(css: string, i: number): number {
  const end = css.indexOf("*/", i + 2);
  return end === -1 ? css.length : end + 2;
}

/** Index of the `}` matching the `{` at `open` (or css.length). */
function matchingBrace(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      i = skipComment(css, i);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return css.length;
}

/** Split a selector list on top-level commas. */
export function splitSelectors(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < prelude.length) {
    const ch = prelude[i];
    if (ch === '"' || ch === "'") {
      i = skipString(prelude, i);
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      out.push(prelude.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  out.push(prelude.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

function stripComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const end = skipString(css, i);
      out += css.slice(i, end);
      i = end;
    } else if (ch === "/" && css[i + 1] === "*") {
      i = skipComment(css, i);
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export function parseCss(source: string): CssNode[] {
  const css = stripComments(source);
  const nodes: CssNode[] = [];
  let i = 0;
  let preludeStart = 0;
  let parenDepth = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (ch === ";" && parenDepth === 0) {
      // Statement at-rule (`@import ...;`, `@charset ...;`).
      const text = css.slice(preludeStart, i + 1).trim();
      if (text) nodes.push({ kind: "raw", text });
      preludeStart = i + 1;
      i++;
      continue;
    }
    if (ch === "{") {
      const close = matchingBrace(css, i);
      parenDepth = 0;
      const prelude = css.slice(preludeStart, i).trim();
      const inner = css.slice(i + 1, close);
      if (prelude.startsWith("@")) {
        const name = /^@([a-z-]+)/i.exec(prelude)?.[1]?.toLowerCase() ?? "";
        if (GROUPING_AT_RULES.has(name)) {
          nodes.push({ kind: "group", prelude, children: parseCss(inner) });
        } else {
          nodes.push({ kind: "raw", text: `${prelude}{${inner.trim()}}` });
        }
      } else if (prelude) {
        nodes.push({ kind: "rule", selectors: splitSelectors(prelude), body: inner.trim() });
      }
      i = close + 1;
      preludeStart = i;
      continue;
    }
    i++;
  }
  const tail = css.slice(preludeStart).trim();
  if (tail) nodes.push({ kind: "raw", text: tail });
  return nodes;
}

export function printCss(nodes: CssNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "raw") return node.text;
      if (node.kind === "group") return `${node.prelude}{\n${printCss(node.children)}\n}`;
      return `${node.selectors.join(", ")}{${node.body}}`;
    })
    .join("\n");
}

export function rootSelector(key: string): string {
  return `[data-c="${key}"]`;
}

/** End index of the first compound selector of `sel` (up to a top-level combinator). */
function firstCompoundEnd(sel: string): number {
  let depth = 0;
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === "\\") i++;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (/\s/.test(ch) || ch === ">" || ch === "+" || ch === "~")) return i;
  }
  return sel.length;
}

/** `sel` with `attr` appended to its first compound, before any pseudo-class/element. */
function attachToFirstCompound(sel: string, attr: string): string {
  const compound = sel.slice(0, firstCompoundEnd(sel));
  let depth = 0;
  let at = compound.length;
  for (let i = 0; i < compound.length; i++) {
    const ch = compound[i];
    if (ch === "\\") i++;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) {
      at = i;
      break;
    }
  }
  return sel.slice(0, at) + attr + sel.slice(at);
}

/** `text` without anything inside parentheses (`:not(...)`, `:is(...)`, `:has(...)`). */
function outsideParens(text: string): string {
  let depth = 0;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

function scopeSelector(selector: string, key: string): string[] {
  const prefix = rootSelector(key);
  const sel = selector.trim();
  // Already scoped: the first compound carries the prefix (root form, tag-led
  // root form, or the leading ancestor of the descendant form). A prefix deeper
  // in, or inside `:not()` / `:has()` / `:is()`, scopes nothing.
  if (outsideParens(sel.slice(0, firstCompoundEnd(sel))).includes(prefix)) return [sel];
  if (sel === ":root" || sel === ":host") return [prefix];
  if (sel.startsWith(":root") || sel.startsWith(":host")) {
    return [prefix + sel.replace(/^:(root|host)/, "")];
  }
  // Pseudo-class first (`:hover`) conventionally targets the root itself.
  if (sel.startsWith(":")) return [prefix + sel];
  // `.x` / `#x` / `[x]` may be the root itself or a descendant: emit both.
  if (/^[.#[]/.test(sel)) return [prefix + sel, `${prefix} ${sel}`];
  // Tag-led (`button`, `a.cta`, `li:hover`, `*`): the root may be that tag.
  if (/^[a-zA-Z*]/.test(sel)) return [attachToFirstCompound(sel, prefix), `${prefix} ${sel}`];
  return [`${prefix} ${sel}`];
}

/** Move `@charset` / `@import` statements ahead of every other node (the only place CSS accepts them). */
function hoistImports(nodes: CssNode[]): CssNode[] {
  const isHead = (n: CssNode) => n.kind === "raw" && /^@(import|charset)\b/i.test(n.text);
  const seen = new Set<string>();
  const head = nodes.filter(isHead).filter((n) => {
    const text = (n as { text: string }).text;
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
  return [...head, ...nodes.filter((n) => !isHead(n))];
}

/**
 * Prefix every selector in `css` with `[data-c="key"]`. Idempotent:
 * `scopeCss(scopeCss(x, k), k) === scopeCss(x, k)`.
 */
export function scopeCss(css: string, key: string): string {
  const walk = (nodes: CssNode[]): CssNode[] =>
    nodes.map((node) => {
      if (node.kind === "group") return { ...node, children: walk(node.children) };
      if (node.kind === "rule") {
        const seen = new Set<string>();
        const selectors: string[] = [];
        for (const s of node.selectors) {
          for (const out of scopeSelector(s, key)) {
            if (!seen.has(out)) {
              seen.add(out);
              selectors.push(out);
            }
          }
        }
        return { ...node, selectors };
      }
      return node;
    });
  return printCss(hoistImports(walk(parseCss(css))));
}

/**
 * Keep only the rules for which at least one selector satisfies `keep`
 * (groups survive when any child does). `@import` and `@font-face` always
 * survive, and so does a `@keyframes` whose name a kept rule mentions; other
 * raw at-rules are dropped.
 */
export function filterCssRules(css: string, keep: (selector: string) => boolean): string {
  const walk = (nodes: CssNode[]): CssNode[] => {
    const out: CssNode[] = [];
    for (const node of nodes) {
      if (node.kind === "rule") {
        if (node.selectors.some(keep)) out.push(node);
      } else if (node.kind === "group") {
        const children = walk(node.children);
        if (children.length > 0) out.push({ ...node, children });
      } else if (/^@(import|charset|font-face)\b/i.test(node.text)) {
        out.push(node);
      }
    }
    return out;
  };
  const all = parseCss(css);
  const kept = walk(all);
  const printedKept = printCss(kept);
  for (const node of all) {
    if (node.kind !== "raw" || !/^@(-webkit-)?keyframes\s/i.test(node.text)) continue;
    const name = /^@(?:-webkit-)?keyframes\s+([^\s{]+)/i.exec(node.text)?.[1];
    if (name && printedKept.includes(name)) kept.push(node);
  }
  return printCss(hoistImports(kept));
}

/** Replace every `[data-c="key"]` in `css` with `[data-d="scope"]`. */
export function rescopeCss(css: string, key: string, scope: string): string {
  return css.split(rootSelector(key)).join(`[data-d="${scope}"]`);
}
