/**
 * Makes a still-streaming HTML prefix safe to mount for the live preview
 * (`StreamingEmbedPreviewLayer`). Browsers auto-close unclosed elements
 * themselves, so only the cut-off *tokens* need repair: an unterminated
 * comment, a half-typed tag or entity at the tail (which would otherwise
 * render as literal text) and an unclosed `<style>`.
 *
 * Pure and total: any string in, a string out, never throws.
 */

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

export function repairPartialHtml(html: string): string {
  if (hasOpenComment(html)) return `${html}-->`;
  let out = html.replace(INCOMPLETE_TAG_RE, "");
  out = out.replace(INCOMPLETE_ENTITY_RE, "");
  if (hasOpenStyle(out)) out += "</style>";
  return out;
}
