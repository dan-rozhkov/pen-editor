/**
 * Makes a still-streaming HTML prefix safe to mount for the live preview
 * (`StreamingEmbedPreviewLayer`). Browsers auto-close unclosed elements
 * themselves, so only the cut-off *tokens* need repair: an unterminated
 * comment, a half-typed tag or entity at the tail (which would otherwise
 * render as literal text) and an unclosed `<style>`.
 *
 * Pure and total: any string in, a string out, never throws.
 */

import { findTagEnd, maskDeadRanges, type ComponentRegistry } from "@/lib/embedComponents";

const INCOMPLETE_TAG_RE = /<(?:[a-zA-Z/!?][^<>]*)?$/;
const INCOMPLETE_ENTITY_RE = /&#?[a-zA-Z0-9]{0,32}$/;

function hasOpenComment(html: string): boolean {
  const open = html.lastIndexOf("<!--");
  return open !== -1 && html.indexOf("-->", open + 4) === -1;
}

function hasOpenStyle(html: string): boolean {
  const lower = html.toLowerCase();
  const open = lower.lastIndexOf("<style");
  return open !== -1 && lower.indexOf("</style", open) === -1;
}

/**
 * Cut a trailing `<c-…` tag that is still open. Only REGISTERED keys count
 * (and `<c-slot>`), `<script>`/`<style>`/comment text is ignored, and quotes
 * are respected (`title="a>b`), the same scan the expander uses.
 */
export function dropOpenComponentTag(html: string, registry: ComponentRegistry | undefined): string {
  if (!registry || registry.size === 0 || !html.includes("<c-")) return html;
  const masked = maskDeadRanges(html);
  const re = /<c-([a-z][a-z0-9-]*)(?=[\s/>]|$)/g;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) if (m[1] === "slot" || registry.has(m[1])) start = m.index;
  if (start === -1) return html;
  return findTagEnd(masked, start + 1) === -1 ? html.slice(0, start) : html;
}

export function repairPartialHtml(html: string, registry?: ComponentRegistry): string {
  if (hasOpenComment(html)) return `${html}-->`;
  html = dropOpenComponentTag(html, registry);
  let out = html.replace(INCOMPLETE_TAG_RE, "");
  out = out.replace(INCOMPLETE_ENTITY_RE, "");
  if (hasOpenStyle(out)) out += "</style>";
  return out;
}
