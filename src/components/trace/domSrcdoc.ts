/** The policy of the sandboxed page: nothing loads from the network; images only from `data:` unless the viewer opts in. */
export const domCsp = (remoteImages: boolean) =>
  `default-src 'none'; style-src 'unsafe-inline'; img-src ${remoteImages ? "data: https: http:" : "data:"}; font-src data:; media-src data:`;

/**
 * Puts a policy `<meta>` and `<base target="_blank">` first in the page's `<head>` (a later policy can only tighten;
 * the first `<base>` with a target wins). Without a head they go first in the document, after any doctype.
 */
export function buildDomSrcdoc(html: string, remoteImages: boolean): string {
  const guard = `<meta http-equiv="Content-Security-Policy" content="${domCsp(remoteImages)}"><base target="_blank">`;
  const head = /<head(?=[\s>/])[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + guard + html.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return doctype[0] + guard + html.slice(doctype[0].length);
  return guard + html;
}
