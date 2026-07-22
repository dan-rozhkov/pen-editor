// Cheap detection of the Pixso clipboard payload — no heavy imports so it's
// safe to call on every paste. The real decoder loads on demand (see index.ts).

export const PIXSO_SENTINEL = '<!--PixsoClipboardData-->'
const PIXSO_SENTINEL_ESCAPED = '&lt;!--PixsoClipboardData--&gt;'

/** Quick check: does this `text/html` clipboard payload come from Pixso? */
export function isPixsoClipboardHtml(html: string): boolean {
  return html.includes(PIXSO_SENTINEL) || html.includes(PIXSO_SENTINEL_ESCAPED)
}
