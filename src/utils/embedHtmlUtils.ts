/**
 * Shared utilities for mounting HTML with body-targeted styles into containers.
 * Used by InlineEmbedEditor, htmlToDesignNodes, and htmlTextureHelpers.
 */

/** Detect whether HTML contains `<body>` tags or CSS selectors targeting `html`/`body`. */
export function hasBodyTargetedStyles(html: string): boolean {
  if (/<body[\s>]/i.test(html)) return true;
  return /(^|[^\w-])(html|body)\s*(,|\{)/im.test(html);
}

export interface MountResult {
  root: HTMLElement;
  wrappedBody: boolean;
  originalHasBodyTag: boolean;
}

function splitSelectorList(selectorText: string): string[] {
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
      const selector = current.trim();
      if (selector) selectors.push(selector);
      current = "";
      continue;
    }
    current += ch;
  }

  const tail = current.trim();
  if (tail) selectors.push(tail);
  return selectors;
}

function selectorTargetsGlobalRoot(selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  return (
    trimmed === ":root" ||
    trimmed === "html" ||
    trimmed.startsWith(":root ") ||
    trimmed.startsWith(":root>") ||
    trimmed.startsWith(":root+") ||
    trimmed.startsWith(":root~") ||
    trimmed.startsWith("html ") ||
    trimmed.startsWith("html>") ||
    trimmed.startsWith("html+") ||
    trimmed.startsWith("html~")
  );
}

function collectRootCustomPropertiesFromRules(
  rules: CSSRuleList | CSSRule[],
  target: Map<string, string>,
): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const selectors = splitSelectorList(rule.selectorText);
      if (!selectors.some(selectorTargetsGlobalRoot)) continue;

      for (let i = 0; i < rule.style.length; i++) {
        const propName = rule.style.item(i);
        if (!propName.startsWith("--")) continue;
        const value = rule.style.getPropertyValue(propName);
        const priority = rule.style.getPropertyPriority(propName);
        target.set(
          propName,
          priority ? `${value.trim()} !important` : value.trim(),
        );
      }
      continue;
    }

    if (rule instanceof CSSMediaRule) {
      if (window.matchMedia(rule.conditionText).matches) {
        collectRootCustomPropertiesFromRules(rule.cssRules, target);
      }
      continue;
    }

    if (rule instanceof CSSSupportsRule) {
      collectRootCustomPropertiesFromRules(rule.cssRules, target);
    }
  }
}

function applyGlobalRootCustomProperties(container: HTMLElement, root: HTMLElement): void {
  const customProperties = new Map<string, string>();
  const styleTags = container.querySelectorAll("style");

  for (const styleTag of styleTags) {
    const cssText = styleTag.textContent;
    if (!cssText) continue;

    const sheet = new CSSStyleSheet();
    try {
      sheet.replaceSync(cssText);
    } catch {
      continue;
    }

    collectRootCustomPropertiesFromRules(sheet.cssRules, customProperties);
  }

  for (const [name, value] of customProperties) {
    root.style.setProperty(name, value);
  }
}

/**
 * Mount HTML into a container, creating a synthetic `<body>` element when the
 * HTML contains body-targeted styles. Returns the effective root for content
 * operations and metadata about the mounting.
 */
export function mountHtmlWithBodyStyles(
  container: HTMLElement,
  html: string,
  width: number,
  height: number,
): MountResult {
  const originalHasBodyTag = /<body[\s>]/i.test(html);
  if (!hasBodyTargetedStyles(html)) {
    container.innerHTML = html;
    applyGlobalRootCustomProperties(container, container);
    return { root: container, wrappedBody: false, originalHasBodyTag: false };
  }

  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");

    for (const node of Array.from(parsed.head.childNodes)) {
      container.appendChild(document.importNode(node, true));
    }

    const body = document.createElement("body");
    body.style.cssText = `
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      margin: 0;
      padding: 0;
    `;
    if (parsed.body.className) body.className = parsed.body.className;
    const parsedBodyStyle = parsed.body.getAttribute("style");
    if (parsedBodyStyle) body.style.cssText += `;${parsedBodyStyle}`;
    body.innerHTML = parsed.body.innerHTML;
    container.appendChild(body);
    applyGlobalRootCustomProperties(container, body);

    return { root: body, wrappedBody: true, originalHasBodyTag };
  } catch {
    container.innerHTML = html;
    applyGlobalRootCustomProperties(container, container);
    return { root: container, wrappedBody: false, originalHasBodyTag };
  }
}
