/**
 * Shared utilities for mounting HTML with body-targeted styles into containers.
 * Used by InlineEmbedEditor, htmlToDesignNodes, and htmlTextureHelpers.
 */

import { sanitizeEmbedHtml } from "./sanitizeEmbedHtml";
import { ensureExternalFontStylesLoaded } from "./fontStylesheets";
import { splitSelectorList as splitSelectorListRaw } from "@/lib/htmlToDesign/cssScoping";

/** Inherited typography baseline shared by the live Shadow-DOM embed and the
 * isolated iframe used by Convert to design. Source CSS can override it. */
export const EMBED_DEFAULT_LINE_HEIGHT = "1.5";

export function applyEmbedInheritedDefaults(element: HTMLElement): void {
  element.style.lineHeight = EMBED_DEFAULT_LINE_HEIGHT;
}

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
  return splitSelectorListRaw(selectorText).filter(Boolean);
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
 * Force eager, synchronous-decode loading for every `<img>`/`<iframe>` under
 * `root`.
 *
 * WHY: embed HTML is mounted live into a Shadow root (see `EmbedLayer.tsx`),
 * and AI-generated embed markup routinely carries `<img loading="lazy">`
 * (the backend's `/optimize` and `/adapt` skills instruct the model to use
 * it). WebKit (mobile Safari) strictly honours `loading="lazy"` against the
 * browser's *visual* viewport: an embed's DOM host is a synthetic viewport
 * that is frequently entirely off-screen relative to that visual viewport
 * (e.g. a narrow mobile canvas panned away from the embed, or the host
 * positioned far outside 0,0), so WebKit never even issues the network
 * request for those images — they silently never load, while surrounding
 * layout renders fine. Chromium loads them regardless of intersection, so
 * the bug is invisible there. Measured with Playwright (chromium vs webkit):
 * on a 390x844 mobile viewport with the embed host off-screen, webkit loaded
 * 3/6 images (the three `loading="lazy"` ones never issued a request) vs.
 * 6/6 for chromium; even a 1440x900 desktop viewport failed the lowest lazy
 * image. An embed must paint its whole content regardless of intersection
 * with the real browser viewport (pan/zoom, export and screenshots all
 * depend on that), so lazy loading has to be neutralised for embed content.
 * The same off-screen exposure applies to the sole surviving `<iframe>`
 * (the YouTube video fill) that can carry `loading="lazy"` post-sanitization.
 *
 * TRADE-OFF (deliberate): `EmbedLayer` mounts every visible embed with no
 * viewport culling of its own, so this makes an image-heavy document request
 * all embed images up front instead of deferring distant ones. That cost is
 * accepted: a deferred image on this canvas is not "loaded later", it is
 * never loaded at all on WebKit. `decoding="async"` (set only when the author
 * did not ask for a specific decode mode) keeps the extra decodes off the
 * main thread. If embed images ever need throttling, cull at the
 * `EmbedLayer` level rather than by restoring native lazy loading.
 */
export function forceEagerImageLoading(root: ParentNode): void {
  for (const el of root.querySelectorAll("img, iframe")) {
    if (el.getAttribute("loading") !== "eager") {
      el.setAttribute("loading", "eager");
    }
    if (el.tagName === "IMG" && !el.hasAttribute("decoding")) {
      el.setAttribute("decoding", "async");
    }
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
  // Hoist allowlisted external font stylesheets (Google Fonts / Phosphor icon
  // fonts) to document level for EVERY shadow-DOM mount. Their class rules apply
  // inside the shadow tree, but Chrome only registers `@font-face` fonts from
  // document-level styles — without this, web/icon fonts render as tofu. Read
  // from the raw `html` because sanitization strips <link> tags below.
  void ensureExternalFontStylesLoaded(html);
  // Embed HTML is untrusted (AI output, pasted markup, shared .pen files) —
  // strip scripts and event handlers before it touches the DOM.
  const safeHtml = sanitizeEmbedHtml(html);
  if (!hasBodyTargetedStyles(html)) {
    container.innerHTML = safeHtml;
    applyGlobalRootCustomProperties(container, container);
    forceEagerImageLoading(container);
    return { root: container, wrappedBody: false, originalHasBodyTag: false };
  }

  try {
    const parsed = new DOMParser().parseFromString(safeHtml, "text/html");

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
    forceEagerImageLoading(container);

    return { root: body, wrappedBody: true, originalHasBodyTag };
  } catch {
    container.innerHTML = safeHtml;
    applyGlobalRootCustomProperties(container, container);
    forceEagerImageLoading(container);
    return { root: container, wrappedBody: false, originalHasBodyTag };
  }
}
