/**
 * A small dedicated tag-balance scanner for embed HTML — not a real parser,
 * just enough to catch an edit that leaves a tag unclosed (the failure mode
 * that broke a real screen: a missing `</div>` nested the mini-map inside
 * the header and collapsed the whole layout).
 *
 * Walks tags with a regex and maintains a stack, ignoring void elements and
 * self-closing tags, and skipping the contents of <script>, <style>, and
 * comments so CSS `>` selectors and JS comparisons don't corrupt the scan.
 */

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

// Matches comments, raw-text element blocks (script/style, consuming their
// content so embedded `<`/`>` never reach the tag scanner), and ordinary tags.
const TOKEN_RE =
  /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;

export interface TagBalanceResult {
  balanced: boolean;
  /** Name and position of the offending unclosed tag, when unbalanced. */
  unclosed?: { tagName: string; index: number };
}

export function checkTagBalance(html: string): TagBalanceResult {
  const stack: { tagName: string; index: number }[] = [];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(html)) !== null) {
    // Comment or a whole <script>/<style> block already consumed — nothing to push.
    if (match[2] === undefined) continue;

    const full = match[0];
    const tagName = match[2].toLowerCase();
    const selfClosing = match[3] === "/";
    const isClosing = full.startsWith("</");

    if (isClosing) {
      // Pop back to the matching opener, discarding anything left dangling
      // above it (browsers auto-close on a mismatched end tag too).
      let i = stack.length - 1;
      while (i >= 0 && stack[i].tagName !== tagName) i -= 1;
      if (i >= 0) {
        stack.length = i;
      }
      // An end tag with no matching opener is ignored, matching browser behaviour.
    } else if (!selfClosing && !VOID_ELEMENTS.has(tagName) && !RAW_TEXT_ELEMENTS.has(tagName)) {
      stack.push({ tagName, index: match.index });
    }
  }

  if (stack.length === 0) {
    return { balanced: true };
  }
  return { balanced: false, unclosed: stack[stack.length - 1] };
}
