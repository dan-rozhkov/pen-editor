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

/** Index of a trailing `<c-…` tag that is still open (quote-aware), else -1. */
function openComponentTagStart(html: string): number {
  const start = html.lastIndexOf("<c-");
  if (start === -1) return -1;
  let quote: string | null = null;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return -1;
    }
  }
  return start;
}

export function repairPartialHtml(html: string): string {
  if (hasOpenComment(html)) return `${html}-->`;
  // A cut-off component tag (`<c-btn kind="pri`, or `title="a>b` inside a
  // quote) goes first: the generic rule below stops at the first `>`.
  const cut = openComponentTagStart(html);
  if (cut !== -1) html = html.slice(0, cut);
  let out = html.replace(INCOMPLETE_TAG_RE, "");
  out = out.replace(INCOMPLETE_ENTITY_RE, "");
  if (hasOpenStyle(out)) out += "</style>";
  return out;
}
