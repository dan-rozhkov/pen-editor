export function scopeStyleTagsToRoot(container: HTMLElement, scopeSelector: string): void {
  const styleElements = container.querySelectorAll("style");
  for (const styleEl of styleElements) {
    const cssText = styleEl.textContent;
    if (!cssText) continue;
    const scoped = scopeCssText(cssText, scopeSelector);
    styleEl.textContent = scoped;
  }
}

function scopeCssText(cssText: string, scopeSelector: string): string {
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(cssText);
  } catch {
    return cssText;
  }
  return scopeCssRules(Array.from(sheet.cssRules), scopeSelector).join("\n");
}

function scopeCssRules(rules: CSSRule[], scopeSelector: string): string[] {
  const output: string[] = [];

  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const selectors = splitSelectorList(rule.selectorText);
      const scopedSelectors = selectors
        .map((selector) => scopeSelectorItem(selector, scopeSelector))
        .join(", ");
      output.push(`${scopedSelectors} { ${rule.style.cssText} }`);
      continue;
    }

    if (rule instanceof CSSMediaRule) {
      const nested = scopeCssRules(Array.from(rule.cssRules), scopeSelector).join("\n");
      output.push(`@media ${rule.conditionText} {\n${nested}\n}`);
      continue;
    }

    if (rule instanceof CSSSupportsRule) {
      const nested = scopeCssRules(Array.from(rule.cssRules), scopeSelector).join("\n");
      output.push(`@supports ${rule.conditionText} {\n${nested}\n}`);
      continue;
    }

    output.push(rule.cssText);
  }

  return output;
}

/** Split a CSS selector list on commas, respecting parentheses and brackets */
export function splitSelectorList(selectorText: string): string[] {
  const selectors: string[] = [];
  let current = "";
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < selectorText.length; i++) {
    const ch = selectorText[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);

    if (ch === "," && parenDepth === 0 && bracketDepth === 0) {
      selectors.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }

  const tail = current.trim();
  if (tail) selectors.push(tail);
  return selectors;
}

function scopeSelectorItem(selector: string, scopeSelector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) return scopeSelector;
  if (trimmed === "html" || trimmed === "body" || trimmed === ":root") {
    return scopeSelector;
  }
  const replacedLeadingRoot = trimmed.replace(
    /^(:root|html|body)(?=[\s>+~.#[:]|$)/,
    scopeSelector,
  );
  if (replacedLeadingRoot !== trimmed) return replacedLeadingRoot;
  return `${scopeSelector} ${trimmed}`;
}
