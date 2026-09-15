/**
 * Shared "is this a text leaf" check for embed content.
 *
 * Two independent editing surfaces need the exact same notion of "an
 * element whose own direct text is worth making editable, and that owns no
 * deeper text container": `InlineEmbedEditor` (which contenteditable-ifies
 * every text leaf under the whole embed at once, for the legacy free-form
 * inline-edit mode) and `EmbedLayer`'s element picker (which asks the same
 * question about ONE element on dblclick, to decide whether to enter
 * single-element text editing). Kept here rather than duplicated so the two
 * can never drift on what counts as "text" — a divergence would show up as
 * "the picker let me dblclick something InlineEmbedEditor would never have
 * made editable" or vice versa, which is much harder to notice than a
 * shared import failing to compile.
 */

/** Tags that should never be made contenteditable. */
export const SKIP_TAGS = new Set([
  "STYLE", "SCRIPT", "SVG", "CANVAS", "VIDEO", "AUDIO", "IFRAME",
  "IMG", "INPUT", "TEXTAREA", "SELECT", "BR", "HR", "META", "LINK",
]);

/**
 * Determine if an element is a "text leaf" — it contains meaningful
 * direct text content and no block-level child elements that themselves
 * contain text.
 * This catches <div>, <span>, <p>, <h1>, <button>, <td>, etc.
 */
export function isTextLeaf(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return false;
  // Must have some non-whitespace text content
  let hasText = false;
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      hasText = true;
    }
  }
  if (!hasText) return false;
  // No child elements that themselves contain text (i.e., this is the deepest text container)
  for (const child of el.children) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    if (child.textContent?.trim()) return false;
  }
  return true;
}
