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
 * component tags — while stripping scripts, event handlers and iframes.
 */

// Whole-document input must be sanitized with WHOLE_DOCUMENT so that
// `<head>` styles survive (fragment mode returns body content only,
// silently dropping them).
const DOC_STRUCTURE_RE = /<\s*(?:html|head|body)[\s>]/i;

export function sanitizeEmbedHtml(html: string): string {
  const wholeDocument = DOC_STRUCTURE_RE.test(html);
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    // <slot> is used for component slot regions and <style> carries embed CSS;
    // neither is in DOMPurify's default fragment allowlist.
    ADD_TAGS: ["slot", "style"],
    ADD_ATTR: ["slot"],
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
