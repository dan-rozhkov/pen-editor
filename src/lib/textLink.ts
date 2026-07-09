import type { TextNode } from "@/types/scene";

/**
 * Default color used to render a text link when the node has no explicit
 * color of its own (`fill`/`fills`) — the same accent blue used everywhere
 * else in the editor's own UI (see `--color-accent-primary` in index.css and
 * `OverlayRenderer.ts`'s `0x0d99ff` constants), which happens to double as a
 * conventional "hyperlink blue".
 */
export const TEXT_LINK_COLOR = "#0d99ff";

/** A link forces an underline, same as Figma, independent of the `underline` toggle. */
export function hasEffectiveUnderline(node: Pick<TextNode, "underline" | "link">): boolean {
  return Boolean(node.underline) || Boolean(node.link);
}

/**
 * Whether a link URL is safe to emit as an `href`. Allows the common
 * navigable schemes plus scheme-relative / relative / anchor URLs, and
 * rejects dangerous ones (`javascript:`, `data:`, `vbscript:`, ...). Applied
 * at HTML/SVG export as defense-in-depth so a `javascript:` URL can't reach
 * the output even for consumers that don't run it through DOMPurify. The URL
 * field is free-text (LinkPopover / AI), so it can't be trusted.
 */
export function isSafeLinkHref(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === "") return false;
  // Relative, absolute-path, anchor, query, or scheme-relative URLs have no
  // scheme to vet and are safe navigational targets.
  if (/^(\/|#|\?|\.)/.test(trimmed)) return true;
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (!schemeMatch) return true; // no scheme (e.g. "example.com/path")
  const scheme = schemeMatch[1].toLowerCase();
  return scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel";
}

/**
 * Parse a markdown-style link `[text](url)` (optionally `[text](url "title")`)
 * out of AI-supplied text content for `batch_design`.
 *
 * Only matches when the ENTIRE trimmed string is a single markdown link —
 * this mirrors `TextNode.link`'s whole-node granularity (see its doc
 * comment in `@/types/scene`): there is no per-character span/run model in
 * this codebase, so a link can only cover an entire text node's content, not
 * a sub-string of otherwise plain text. A string that merely contains
 * markdown-link-looking text alongside other content is left untouched.
 */
export function parseMarkdownLink(
  raw: string,
): { text: string; url: string; title?: string } | null {
  const trimmed = raw.trim();
  const match = /^\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/.exec(trimmed);
  if (!match) return null;
  const [, text, url, title] = match;
  return title ? { text, url, title } : { text, url };
}
