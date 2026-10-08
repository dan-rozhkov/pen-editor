// Phase 1 gate (tokens v2): the same document exported to DTCG, tokens.css and a
// Tailwind v4 file resolves, per token and per mode, to what `resolveVariable` says.
import { describe, it, expect } from "vitest";
import type { ModeContext, Variable, VariableCollection, VariableModeValue } from "@/types/variable";
import { buildVariableIndex, finalizeVariables, resolveVariable } from "@/lib/variables";
import { toDtcg } from "../toDtcg";
import { fromDtcg } from "../fromDtcg";
import { toCss } from "../toCss";
import { toTailwindTheme } from "../toTailwindTheme";
import { isToken, readPenExt, type DtcgToken } from "../dtcgTypes";
import { nameToSegments, walkTokens } from "../tokenPath";

const collections: VariableCollection[] = [
  { id: "prim", name: "Primitives", modes: [{ id: "default", name: "Default" }], defaultModeId: "default" },
  { id: "theme", name: "Theme", modes: [{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }], defaultModeId: "light" },
  {
    id: "brand", name: "Brand",
    modes: [{ id: "mode_a", name: "Brand A" }, { id: "mode_b", name: "Brand B" }],
    defaultModeId: "mode_a",
  },
];

function v(
  id: string, name: string, type: Variable["type"], collectionId: string,
  valuesByMode: Record<string, VariableModeValue>, extra: Partial<Variable> = {},
): Variable {
  return { id, name, type, collectionId, valuesByMode, value: "", ...extra };
}
const al = (alias: string): VariableModeValue => ({ alias });

const variables: Variable[] = finalizeVariables(
  [
    v("blue", "Color/Blue 500", "color", "prim", { default: "#0000ff" }),
    v("white", "color/white", "color", "prim", { default: "#ffffff" }),
    v("black", "color/black", "color", "prim", { default: "#000000" }),
    v("space4", "Space 4", "number", "prim", { default: "4" }, { scopes: ["spacing"] }),
    v("radius", "radius/md", "number", "prim", { default: "8" }, { scopes: ["radius"] }),
    v("font", "font/body", "string", "prim", { default: "Inter, sans-serif" }),
    v("weird", "font/weird", "string", "prim", { default: 'Foo; "bar" }' }),
    v("bg", "bg", "color", "theme", { light: al("white"), dark: al("black") }),
    v("fg", "fg", "color", "theme", { light: "#111111", dark: al("white") }),
    v("surface", "surface", "color", "theme", { light: al("accent"), dark: "#222222" }),
    v("accent", "accent", "color", "brand", { mode_a: al("blue"), mode_b: "#ff00aa" }),
    v("density", "density", "number", "brand", { mode_a: "4", mode_b: al("space4") }, { scopes: ["gap"] }),
    v("tight", "tight", "number", "brand", { mode_a: "2" }), // mode_b falls back to the default
  ],
  collections,
);

const index = buildVariableIndex(variables, collections);
const contexts: ModeContext[] = [];
for (const theme of ["light", "dark"]) for (const brand of ["mode_a", "mode_b"]) contexts.push({ theme, brand });

function expected(id: string, ctx: ModeContext): string {
  const r = resolveVariable(index, id, ctx);
  if (!r.ok) throw new Error(`fixture does not resolve: ${id}`);
  return r.value;
}

// ---- test-only DTCG resolver (does not use fromDtcg) ----
function dtcgResolver(doc: ReturnType<typeof toDtcg>["document"]) {
  const byPath = new Map<string, DtcgToken>();
  const byId = new Map<string, DtcgToken>();
  walkTokens(doc, (t, segs) => {
    byPath.set(segs.join("."), t);
    const ext = readPenExt(t);
    if (ext?.source === "variable") byId.set(ext.id, t);
  });
  const resolve = (token: DtcgToken, ctx: ModeContext): string => {
    const ext = readPenExt(token);
    const coll = ext?.collection ?? collections.find((c) => c.id === "theme");
    let raw: unknown = token.$value;
    const mode = ctx[coll?.id ?? "theme"];
    if (ext?.modes && mode !== undefined && ext.modes[mode] !== undefined) raw = ext.modes[mode];
    else if (!ext?.modes && coll?.id === "theme" && mode === "dark" && ext?.themes) raw = ext.themes.dark;
    const m = typeof raw === "string" ? /^\{(.+)\}$/.exec(raw) : null;
    if (m) {
      const target = byPath.get(m[1]);
      if (!target || !isToken(target)) throw new Error(`dangling alias ${raw}`);
      return resolve(target, ctx);
    }
    return String(raw);
  };
  return (id: string, ctx: ModeContext) => resolve(byId.get(id) as DtcgToken, ctx);
}

// ---- test-only CSS parser/resolver ----
interface Rule { selector: string; decls: Array<[string, string]> }
function parseCss(src: string): Rule[] {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let i = 0;
  const readSegment = (): { text: string; end: string } => {
    let text = "";
    let quote = false;
    while (i < css.length) {
      const ch = css[i];
      if (quote) {
        text += ch;
        if (ch === "\\") text += css[++i];
        else if (ch === '"') quote = false;
        i++;
        continue;
      }
      if (ch === '"') { quote = true; text += ch; i++; continue; }
      if (ch === ";" || ch === "{" || ch === "}") { i++; return { text: text.trim(), end: ch }; }
      text += ch; i++;
    }
    return { text: text.trim(), end: "" };
  };
  const block = (selector: string): void => {
    const rule: Rule = { selector, decls: [] };
    rules.push(rule);
    for (;;) {
      const { text, end } = readSegment();
      if (end === "{") block(text);
      else {
        if (text) {
          const k = text.indexOf(":");
          rule.decls.push([text.slice(0, k).trim(), text.slice(k + 1).trim()]);
        }
        if (end === "}" || end === "") return;
      }
    }
  };
  for (;;) {
    const { text, end } = readSegment();
    if (end === "{") block(text);
    else if (end === "") return rules;
  }
}
const attrFor: Record<string, [string, (m: string) => string]> = {
  theme: ["theme", (m) => m],
  brand: ["brand", (m) => ({ mode_a: "brand-a", mode_b: "brand-b" })[m] as string],
};
function cssResolver(css: string, nameOf: (v: Variable) => string) {
  const rules = parseCss(css);
  return (id: string, ctx: ModeContext): string => {
    const props = new Map<string, string>();
    const matches = (sel: string): boolean => {
      if (sel === ":root" || sel === "@theme") return true;
      return Object.entries(ctx).some(([cid, mode]) => {
        const a = attrFor[cid];
        return a !== undefined && sel === `[data-${a[0]}="${a[1](mode)}"]`;
      });
    };
    const rootOnly = rules.filter((r) => r.selector === ":root" || r.selector === "@theme");
    for (const r of [...rootOnly, ...rules.filter((r) => !rootOnly.includes(r) && matches(r.selector))]) {
      for (const [k, val] of r.decls) props.set(k, val);
    }
    const chase = (name: string, depth = 0): string => {
      if (depth > 32) throw new Error("css cycle");
      const raw = props.get(name);
      if (raw === undefined) throw new Error(`missing ${name}`);
      const m = /^var\((--[^)]+)\)$/.exec(raw);
      if (m) return chase(m[1], depth + 1);
      if (raw.startsWith('"')) return raw.slice(1, -1).replace(/\\a /g, "\n").replace(/\\(.)/g, "$1");
      return raw;
    };
    return chase(nameOf(index.byId.get(id) as Variable));
  };
}

const cssName = (x: Variable): string => {
  const slug = x.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `--${slug}`;
};
const twName = (x: Variable): string => {
  const ns = x.type === "color" ? "color-" : x.scopes?.includes("radius") ? "radius-"
    : x.scopes?.some((s) => s === "spacing" || s === "gap") ? "spacing-" : "";
  return `--${ns}${cssName(x).slice(2)}`;
};

describe("tokens v2 exit criteria: every token and mode agrees across DTCG, CSS and Tailwind", () => {
  const dtcg = toDtcg({ variables, collections, fillStyles: [], effectStyles: [], textStyles: [] });
  const css = toCss({ variables, collections });
  const tw = toTailwindTheme({ variables, collections });

  it.each([
    ["DTCG", () => dtcgResolver(dtcg.document)],
    ["tokens.css", () => cssResolver(css.css, cssName)],
    ["Tailwind", () => cssResolver(tw.css, twName)],
  ] as const)("%s equals resolveVariable", (_label, make) => {
    const resolve = make();
    for (const ctx of contexts) {
      for (const x of variables) {
        expect(resolve(x.id, ctx), `${x.name} @ ${JSON.stringify(ctx)}`).toBe(expected(x.id, ctx));
      }
    }
  });

  it("emits only differing variables in a mode block and var() for aliases", () => {
    expect(css.css).toContain('[data-theme="dark"]');
    expect(css.css).toContain('[data-brand="brand-b"]');
    expect(css.css).toContain("--bg: var(--color-white);");
    const dark = css.css.split('[data-theme="dark"]')[1].split("}")[0];
    expect(dark).not.toContain("--space-4");
    expect(dark).toContain("--bg: var(--color-black);");
    const brandB = css.css.split('[data-brand="brand-b"]')[1].split("}")[0];
    expect(brandB).not.toContain("--tight");
  });

  it("uses Tailwind namespaces, the dark variant and a plain :root for the rest", () => {
    expect(tw.css).toContain("@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));");
    expect(tw.css).toContain("@theme {");
    expect(tw.css).toContain("--color-bg: var(--color-color-white);");
    expect(tw.css).toContain("--radius-radius-md: 8;");
    expect(tw.css).toContain("--spacing-space-4: 4;");
    expect(tw.css).toMatch(/@layer base \{\s*\[data-theme="dark"\]/);
    expect(tw.css).toMatch(/Tokens with no Tailwind theme namespace \*\/\s*:root \{[^}]*--font-body/);
  });

  it("DTCG round trip keeps collections, modes and aliases", () => {
    const { result, warnings } = fromDtcg(dtcg.document);
    expect(warnings.filter((w) => !/DTCG has no string type/.test(w))).toEqual([]);
    expect(result.collections.map((c) => c.id).sort()).toEqual(["brand", "prim", "theme"]);
    for (const c of collections) expect(result.collections.find((r) => r.id === c.id)).toEqual(c);
    for (const orig of variables) {
      const back = result.variables.find((r) => r.id === orig.id);
      expect(back, orig.name).toBeDefined();
      expect(back?.collectionId).toBe(orig.collectionId);
      expect(back?.valuesByMode).toEqual(orig.valuesByMode);
      expect(back?.name).toBe(orig.name);
    }
    const idx = buildVariableIndex(result.variables, result.collections);
    for (const ctx of contexts) {
      for (const x of variables) {
        const r = resolveVariable(idx, x.id, ctx);
        expect(r.ok && r.value).toBe(expected(x.id, ctx));
      }
    }
  });

  it("paths are the unprefixed names", () => {
    expect(Object.keys(dtcg.document)).toEqual(expect.arrayContaining(["Color", "bg", "accent"]));
    expect(nameToSegments("Color/Blue 500")).toEqual(["Color", "Blue 500"]);
  });
});
