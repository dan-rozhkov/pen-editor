import DOMPurify from "dompurify";

/**
 * Sanitize embed `htmlContent` before it touches a live (or even detached)
 * DOM. Embed HTML can come from AI output, pasted markup, or shared .pen
 * files; without sanitization `<img onerror=...>` / `<svg onload=...>`
 * handlers execute in the app's origin as soon as the markup is mounted
 * (shadow DOM isolates styles, not scripts).
 *
 * Keeps everything the design renderer needs — `<style>` tags, inline
 * styles, classes, SVG, data URIs on images, `<slot>` elements and `<c-*>`
 * component tags — while stripping scripts, event handlers and (almost)
 * every iframe. The one exception is a YouTube embed iframe emitted by
 * `generateVideoFillHtml` for a YouTube video fill — see the
 * `uponSanitizeElement` hook below, which is the ONLY thing that keeps an
 * `<iframe>` alive, and only when its `src` points at a YouTube embed host.
 * Arbitrary/pasted HTML containing an iframe to any other host is still
 * stripped, exactly as before.
 *
 * NOTE for future test authors: DOMPurify's actual tag-stripping cannot be
 * exercised through this repo's Vitest `happy-dom` environment — DOMPurify's
 * DOM walk silently no-ops (or drops output entirely) against a happy-dom
 * `DOMParser` document, independent of anything in this file (reproducible
 * with a bare `DOMPurify.sanitize('<script>x</script>')` call and no custom
 * config at all). There were no pre-existing tests exercising
 * `sanitizeEmbedHtml` for the same reason. `isAllowedIframeSrc` is exported
 * and unit-tested directly instead; the end-to-end sanitize behavior is
 * real-browser/e2e territory.
 */

// Hosts an iframe's `src` may point at once "iframe" is allowed in
// ADD_TAGS below. Keep this in sync with the exporter (`youTubeEmbedUrl`
// only ever builds a `https://www.youtube.com/embed/<id>` URL) — this is a
// defense-in-depth allowlist, not the only thing standing between untrusted
// HTML and an arbitrary embedded origin.
const ALLOWED_IFRAME_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
]);

/** Whether an iframe `src` is allowed to survive sanitization — https-only,
 *  exact-host match against `ALLOWED_IFRAME_HOSTS` (no base URL, so a
 *  relative/protocol-relative src is rejected rather than resolved). */
export function isAllowedIframeSrc(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && ALLOWED_IFRAME_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

// Registered once on the shared DOMPurify instance. Only takes effect for
// sanitize() calls that put "iframe" in ADD_TAGS/ALLOWED_TAGS (i.e. this
// module) — every other DOMPurify.sanitize call in the app still has iframe
// outside its allowed tag set, so the tag is removed before this hook could
// matter for them.
DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName !== "iframe") return;
  const el = node as Element;
  const src = el.getAttribute("src") ?? "";
  if (!isAllowedIframeSrc(src)) {
    el.remove();
  }
});

// Whole-document input must be sanitized with WHOLE_DOCUMENT so that
// `<head>` styles survive (fragment mode returns body content only,
// silently dropping them).
const DOC_STRUCTURE_RE = /<\s*(?:html|head|body)[\s>]/i;

export function sanitizeEmbedHtml(html: string): string {
  const wholeDocument = DOC_STRUCTURE_RE.test(html);
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    // <slot> is used for component slot regions, <style> carries embed CSS,
    // and <iframe> is allowed ONLY for the YouTube video-fill embed (see the
    // `uponSanitizeElement` hook above, which strips any iframe whose `src`
    // isn't an allowed YouTube host).
    ADD_TAGS: ["slot", "style", "iframe"],
    ADD_ATTR: ["slot", "allow", "allowfullscreen", "frameborder", "referrerpolicy"],
    CUSTOM_ELEMENT_HANDLING: {
      // Component instance tags (<c-button>, <c-card>, ...).
      tagNameCheck: (tagName) => tagName.startsWith("c-"),
      // Never let event handler attributes through on custom elements.
      attributeNameCheck: (attr) => !attr.toLowerCase().startsWith("on"),
      allowCustomizedBuiltInElements: false,
    },
    WHOLE_DOCUMENT: wholeDocument,
    // Without FORCE_BODY the HTML parser hoists leading <style> tags into
    // <head>, which fragment mode then silently drops.
    FORCE_BODY: !wholeDocument,
  });
}
