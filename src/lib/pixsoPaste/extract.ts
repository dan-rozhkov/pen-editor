// Pull the base64 `data-fic` payload out of Pixso's clipboard HTML. Regex-based
// (no DOMParser dependency) — the attribute value is plain base64 (no quotes/<>
// inside), and this runs identically in happy-dom tests and the browser.

const DATA_FIC_RE = /data-fic="([^"]+)"/

export function extractPixsoDataFic(html: string): string | null {
  const m = html.match(DATA_FIC_RE)
  return m ? m[1] : null
}
