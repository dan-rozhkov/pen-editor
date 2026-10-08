/**
 * Rename CSS custom-property references inside an HTML/CSS string.
 *
 * Pure and single-pass (a swap `{--a: --b, --b: --a}` does not cascade). Matches
 *   - `var(--old` followed by `,` / `)` (whitespace allowed) — never `--old-2`;
 *   - inline declarations `--old:` — never `--old-2:`.
 * Operates on plain strings only, so it works for any HTML carrier (embed
 * `htmlContent`, and anything else that stores markup).
 */
const VAR_REF = /(var\(\s*)(--[A-Za-z0-9_-]+)(?=\s*[,)])/g;
const DECLARATION = /(?<![\w-])(--[A-Za-z0-9_-]+)(?=\s*:)/g;

export function rewriteCssVarRefs(html: string, map: Readonly<Record<string, string>>): string {
  if (!html || Object.keys(map).length === 0) return html;
  const lookup = (name: string): string | undefined =>
    Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined;
  return html
    .replace(VAR_REF, (whole, head: string, name: string) => {
      const next = lookup(name);
      return next === undefined ? whole : head + next;
    })
    .replace(DECLARATION, (whole, name: string) => lookup(name) ?? whole);
}
