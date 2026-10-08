// src/lib/designTokens/toTailwindTheme.ts
import { THEME_COLLECTION_ID, getVariableCssName, type Variable } from "@/types/variable";
import { formatDecls, isLengthScoped, planCssTokens, type CssDecl, type CssTokenInput } from "./cssTokens";

/** The Tailwind v4 theme namespace a variable belongs to, or undefined if none maps. */
export function tailwindNamespace(v: Variable): string | undefined {
  if (v.type === "color") return "color";
  for (const scope of v.scopes ?? []) {
    if (scope === "radius") return "radius";
    if (scope === "spacing" || scope === "gap") return "spacing";
    if (scope === "fontSize") return "text";
  }
  return undefined;
}

/** `--<namespace>-<name>`; a variable with no namespace keeps its plain custom-property name. */
export function tailwindName(v: Variable): string {
  const ns = tailwindNamespace(v);
  const plain = getVariableCssName(v);
  return ns ? `--${ns}-${plain.replace(/^--/, "")}` : plain;
}

/**
 * Tailwind v4 CSS: mappable default values in `@theme`, the rest in a plain
 * `:root`, non-default modes in `@layer base`, plus the `dark` custom variant
 * when the Theme collection has a dark mode.
 */
export function toTailwindTheme(input: CssTokenInput): { css: string; warnings: string[] } {
  // Length namespaces (radius, spacing, text) take px, like any other length-scoped number.
  const plan = planCssTokens(input, {
    nameOf: tailwindName,
    isLength: isLengthScoped,
  });
  const themed: CssDecl[] = plan.defaults.filter((d) => tailwindNamespace(d.variable));
  const plain: CssDecl[] = plan.defaults.filter((d) => !tailwindNamespace(d.variable));
  const blocks: string[] = [];

  const hasDark = plan.modes.some((m) => m.collectionId === THEME_COLLECTION_ID && m.selector === '[data-theme="dark"]');
  if (hasDark) {
    blocks.push("@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));");
  }
  if (themed.length > 0) blocks.push(`@theme {\n${formatDecls(themed, "  ")}\n}`);
  if (plain.length > 0) {
    blocks.push(`/* Tokens with no Tailwind theme namespace */\n:root {\n${formatDecls(plain, "  ")}\n}`);
  }
  if (plan.modes.length > 0) {
    const inner = plan.modes
      .map((m) => `  ${m.selector} {\n${formatDecls(m.decls, "    ")}\n  }`)
      .join("\n");
    blocks.push(`@layer base {\n${inner}\n}`);
  }
  return { css: `${blocks.join("\n\n")}\n`, warnings: plan.warnings };
}
