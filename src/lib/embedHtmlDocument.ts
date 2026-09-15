/**
 * Shared DOM plumbing for reading/writing an embed's raw `htmlContent`
 * string: parsing it into a `Document` and re-serializing one back out while
 * preserving the original string's shape (full document / body-only
 * fragment / bare fragment).
 *
 * Split out of `embedElementStyle.ts` (which originated this logic for
 * `applyEmbedElementEdit`) into its own module, rather than folded into
 * either `embedElementStyle.ts` or `embedHtmlStructure.ts`, because both of
 * those need it and `embedHtmlStructure.ts` also needs
 * `shadowPathToSourcePath` from `embedElementStyle.ts` — putting the shared
 * bit in either of the two would create a circular import between them.
 */

/** Parse an embed's raw `htmlContent` string into a `Document`. Returns null
 * on a parser failure rather than throwing, so callers can treat "malformed
 * html" the same as any other unresolvable-edit case. */
export function parseEmbedHtml(html: string): Document | null {
  try {
    return new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
}

/** Does `html` (the raw, unparsed source string) contain a literal `<tag`
 * open, ignoring case and requiring a following whitespace/`>` so `<bodyx>`
 * doesn't false-match `<body`. */
export function hasOpenTag(html: string, tag: string): boolean {
  return new RegExp(`<${tag}[\\s>]`, "i").test(html);
}

/**
 * Re-serialize `doc` (a `Document` obtained from `parseEmbedHtml(html)`,
 * possibly mutated since) back to a string, preserving the *shape* of the
 * original `html` string rather than always emitting a full document or
 * always a fragment: `htmlContent` round-trips through the edit/structure
 * functions repeatedly (each panel action calls one of them again against
 * its own previous output), and an embed's mounting behavior depends on
 * which of `<html>`/`<body>`/bare-fragment shape it has
 * (`hasBodyTargetedStyles`/`mountHtmlWithBodyStyles` in `embedHtmlUtils.ts`)
 * — silently promoting a fragment to a full document (or vice versa) on the
 * first edit would change how every subsequent mount behaves, not just the
 * one element that call touched.
 */
export function serializeEmbedDoc(html: string, doc: Document): string {
  if (hasOpenTag(html, "html")) {
    // Full document: preserve a leading DOCTYPE (DOMParser doesn't include
    // it in `documentElement.outerHTML`) and re-serialize the whole tree.
    const doctypeMatch = /^\s*<!doctype[^>]*>/i.exec(html);
    return (doctypeMatch ? doctypeMatch[0] : "") + doc.documentElement.outerHTML;
  }
  if (hasOpenTag(html, "body")) {
    // Body-only fragment (with or without a <head>): keep that shape rather
    // than promoting to a full <html> document.
    // Head content survives either way: DOMParser hoists leading
    // <style>/<meta>/<link> into `doc.head` even when the source string never
    // wrote a <head> tag, so dropping it whenever the tag is absent would
    // silently delete the screen's stylesheet on the first element edit.
    const headPart = hasOpenTag(html, "head")
      ? `<head>${doc.head.innerHTML}</head>`
      : doc.head.innerHTML;
    return headPart + doc.body.outerHTML;
  }
  // Bare content fragment: no wrapper tags to preserve at all.
  return doc.head.innerHTML + doc.body.innerHTML;
}
