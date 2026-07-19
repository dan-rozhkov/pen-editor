/** Dedup stylesheet loads for external web-font providers */
const pendingFontStylesheets = new Map<string, Promise<void>>();

/**
 * Hosts whose stylesheets we are willing to inject at the document level so that
 * their `@font-face` rules register (Chrome only registers fonts from
 * document-level styles, never from inside a shadow tree — see EmbedLayer).
 *
 * SECURITY: document-level CSS from embed content can restyle the entire app, so
 * this allowlist is intentionally tight — only the web-font/icon-font CDNs the
 * design agent actually emits. Do NOT widen it to arbitrary third-party hosts.
 */
const FONT_STYLESHEET_HOST_ALLOWLIST = new Set([
  "fonts.googleapis.com",
  "unpkg.com",
]);

function isAllowedFontStylesheetHost(url: string): boolean {
  try {
    return FONT_STYLESHEET_HOST_ALLOWLIST.has(new URL(url).hostname);
  } catch {
    // Relative / malformed URLs can't be resolved to an allowlisted host.
    return false;
  }
}

/**
 * Extract external font-stylesheet URLs from raw embed HTML, from BOTH
 * `@import url(...)` rules inside `<style>` blocks and `<link rel="stylesheet">`
 * tags (the latter get stripped by sanitization downstream, so we read the raw
 * HTML here). Only URLs on {@link FONT_STYLESHEET_HOST_ALLOWLIST} are returned.
 */
export function extractExternalFontStylesheetUrls(html: string): string[] {
  const urls = new Set<string>();

  // <link ... rel="stylesheet" ... href="..."> (attribute order independent)
  const linkPattern = /<link\b[^>]*>/gi;
  let linkMatch: RegExpExecArray | null = null;
  while ((linkMatch = linkPattern.exec(html)) !== null) {
    const tag = linkMatch[0];
    if (!/\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
    const url = href?.[1]?.trim();
    if (url) urls.add(url);
  }

  // @import url(...) with optional quotes, and @import "..." string form.
  const importPattern =
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)/gi;
  let importMatch: RegExpExecArray | null = null;
  while ((importMatch = importPattern.exec(html)) !== null) {
    const url = (importMatch[2] ?? importMatch[4] ?? "").trim();
    if (url) urls.add(url);
  }

  return [...urls].filter(isAllowedFontStylesheetHost);
}

function ensureFontStylesheetLoaded(url: string): Promise<void> {
  const pending = pendingFontStylesheets.get(url);
  if (pending) return pending;

  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  const tracked = promise.finally(() => { pendingFontStylesheets.delete(url); });
  pendingFontStylesheets.set(url, tracked);

  const existing = document.head.querySelector<HTMLLinkElement>(
    `link[data-embed-font-url="${CSS.escape(url)}"]`,
  );
  if (existing) {
    if ((existing.sheet as CSSStyleSheet | null) != null) {
      resolve();
    } else {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", resolve, { once: true });
    }
    return tracked;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.dataset.embedFontUrl = url;
  link.onload = resolve;
  link.onerror = resolve;
  document.head.appendChild(link);
  return tracked;
}

export async function ensureExternalFontStylesLoaded(html: string): Promise<void> {
  if (typeof document === "undefined") return;
  const urls = extractExternalFontStylesheetUrls(html);
  if (urls.length === 0) return;

  await Promise.all(urls.map((url) => ensureFontStylesheetLoaded(url)));
}

function collectComputedFontFamilies(root: Element): string[] {
  const families = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const parent = node.parentElement;
    if (!parent) continue;
    const family = window.getComputedStyle(parent).fontFamily?.trim();
    if (family) families.add(family);
  }
  return [...families];
}

export async function waitForFontsUsedInTree(root: Element): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;

  const families = collectComputedFontFamilies(root);
  if (families.length === 0) return;

  const loadPromises = families.map((family) =>
    document.fonts.load(`16px ${family}`),
  );

  // Do not block rendering indefinitely on font providers.
  const timeoutMs = 1200;
  await Promise.race([
    Promise.allSettled(loadPromises),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
