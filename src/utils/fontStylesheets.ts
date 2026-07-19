/**
 * Hoisting of external web-font / icon-font stylesheets from embed HTML to the
 * document level. Chrome only registers `@font-face` fonts from document-level
 * styles, never from inside a shadow tree — so every shadow-DOM mount of embed
 * markup (live EmbedLayer, inline editor, natural-size measurement, texture
 * rasterization) routes through here to make icon/text web fonts resolve
 * instead of rendering as tofu.
 */

/** Dedup stylesheet loads per resolved URL. */
const pendingFontStylesheets = new Map<string, Promise<void>>();

/**
 * Base used to resolve protocol-relative (`//host/path`) and relative URLs.
 * For `//host/path` inputs the host from the input wins and the scheme is taken
 * from this base; plain-relative inputs (e.g. `/style.css`) resolve onto the
 * `relative.invalid` host, which is not allowlisted — so relative URLs are
 * rejected, preserving the "no relative stylesheets" behavior.
 */
const FONT_STYLESHEET_URL_BASE = "https://relative.invalid";

/**
 * SECURITY: document-level CSS from embed content can restyle the entire app, so
 * this allowlist is intentionally tight — only the web-font/icon-font CDNs the
 * design agent actually emits, and unpkg only for the Phosphor icon-font package
 * (unpkg serves arbitrary npm-package CSS, so a whole-host allow would be a hole).
 * Do NOT widen it to arbitrary third-party hosts.
 */
function isAllowedFontStylesheetUrl(parsed: URL): boolean {
  if (parsed.hostname === "fonts.googleapis.com") return true;
  if (
    parsed.hostname === "unpkg.com" &&
    parsed.pathname.startsWith("/@phosphor-icons/")
  ) {
    return true;
  }
  return false;
}

/**
 * Resolve a raw stylesheet URL to its absolute https form iff it lands on an
 * allowlisted host/path; otherwise return null. Protocol-relative URLs are
 * resolved against {@link FONT_STYLESHEET_URL_BASE}; the scheme is forced to
 * https so the hoisted `<link>` never downgrades to http.
 */
function normalizeAllowedFontStylesheetUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, FONT_STYLESHEET_URL_BASE);
  } catch {
    return null;
  }
  if (!isAllowedFontStylesheetUrl(parsed)) return null;
  parsed.protocol = "https:";
  return parsed.href;
}

/**
 * Extract external font-stylesheet URLs from raw embed HTML, from BOTH
 * `@import url(...)` / `@import "..."` rules inside `<style>` blocks and
 * `<link rel="stylesheet">` tags (the latter get stripped by sanitization
 * downstream, so we read the raw HTML here). Only allowlisted URLs are
 * returned, normalized to their absolute https form.
 */
export function extractExternalFontStylesheetUrls(html: string): string[] {
  const raw = new Set<string>();

  // <link ... rel="stylesheet" ... href="..."> (attribute order independent)
  const linkPattern = /<link\b[^>]*>/gi;
  let linkMatch: RegExpExecArray | null = null;
  while ((linkMatch = linkPattern.exec(html)) !== null) {
    const tag = linkMatch[0];
    if (!/\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(tag)) continue;
    // Skip `rel="alternate stylesheet"` — those are opt-in alternates, not the
    // active stylesheet, and must not be force-loaded at document level.
    if (/\brel\s*=\s*["']?[^"'>]*\balternate\b/i.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
    const url = href?.[1]?.trim();
    if (url) raw.add(url);
  }

  // @import url(...) with optional quotes, and @import "..." string form.
  const importPattern =
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)/gi;
  let importMatch: RegExpExecArray | null = null;
  while ((importMatch = importPattern.exec(html)) !== null) {
    const url = (importMatch[2] ?? importMatch[4] ?? "").trim();
    if (url) raw.add(url);
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const url of raw) {
    const resolved = normalizeAllowedFontStylesheetUrl(url);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      normalized.push(resolved);
    }
  }
  return normalized;
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
      existing.addEventListener("load", () => resolve(), { once: true });
      // A failed load must not leave a permanently-broken <link> behind: remove
      // it so the next request re-adds a fresh one instead of re-attaching a
      // listener to a link whose error event already fired (which would never
      // settle and wedge the dedupe map forever).
      existing.addEventListener(
        "error",
        () => { existing.remove(); resolve(); },
        { once: true },
      );
    }
    return tracked;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.dataset.embedFontUrl = url;
  link.onload = () => resolve();
  link.onerror = () => { link.remove(); resolve(); };
  document.head.appendChild(link);
  return tracked;
}

/**
 * Hoist every allowlisted external font stylesheet referenced by `html` to
 * `document.head`. Deliberate trade-off: hoisted `<link>`s are never removed and
 * dedupe is per resolved URL — bounded by the (small) set of distinct
 * allowlisted URLs, and font CSS is namespaced so it can't restyle the app.
 */
export async function ensureExternalFontStylesLoaded(html: string): Promise<void> {
  if (typeof document === "undefined") return;
  const urls = extractExternalFontStylesheetUrls(html);
  if (urls.length === 0) return;

  await Promise.all(urls.map((url) => ensureFontStylesheetLoaded(url)));
}
