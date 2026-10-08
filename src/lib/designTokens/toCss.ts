// src/lib/designTokens/toCss.ts
import { formatDecls, planCssTokens, type CssTokenInput } from "./cssTokens";

/**
 * A standalone `tokens.css`: default-mode values on `:root`, each non-default
 * mode in `[data-<collection>="<mode>"]` holding only what differs. Aliases are
 * `var(--target)`, so the cascade stays live. Put the `data-*` attribute on the
 * same element as `:root` (`<html>`): a custom property that holds `var()` is
 * resolved where it is declared, so a mode set on a nested element does not
 * re-resolve aliases declared on `:root`.
 */
export function toCss(input: CssTokenInput): { css: string; warnings: string[] } {
  const plan = planCssTokens(input);
  const blocks: string[] = [];
  blocks.push(`:root {\n${formatDecls(plan.defaults, "  ")}\n}`);
  for (const mode of plan.modes) blocks.push(`${mode.selector} {\n${formatDecls(mode.decls, "  ")}\n}`);
  return { css: `${blocks.join("\n\n")}\n`, warnings: plan.warnings };
}
