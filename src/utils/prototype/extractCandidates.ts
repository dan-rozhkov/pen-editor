import type { PrototypeCandidate } from "./types";

export interface ExtractResult {
  annotatedHtml: string;
  /**
   * Content the HTML parser routed into `<head>` (top-level `<style>`,
   * `<link rel="stylesheet">`, etc.). In a real browser a leading `<style>`
   * in a fragment lands in `<head>`, NOT `<body>` — the same reason the embed
   * renderer hoists `parsed.head.childNodes` (`mountHtmlWithBodyStyles`). We
   * must carry it through so the exported prototype keeps its styling; reading
   * only `body.innerHTML` would silently drop all CSS.
   */
  headHtml: string;
  candidates: PrototypeCandidate[];
  /**
   * The screen's visible text (`doc.body.textContent`), whitespace-collapsed
   * and capped at ~1200 chars — sent to the link-graph LLM so it has enough
   * context to reason about where a screen fits in the flow, without
   * shipping the full HTML (expensive on tokens).
   */
  contentText: string;
}

const SEMANTIC_SELECTOR = 'a, button, [role="button"], [onclick], [tabindex]';
const MAX_TEXT = 80;
const MAX_CONTENT_TEXT = 1200;

/**
 * Class-name stems that signal a navigational/interactive element in design
 * embeds, where cards, tabs, nav rows, and list items are almost always
 * styled `<div>`s with no `<a>`/`<button>`/`role` — the reason a plant card
 * (`<div class="plant-card">`) never became linkable. Matched as a whole
 * token within a space/`-`/`_`-separated class list, so `plant-card` matches
 * `card` but `card` never matches an unrelated `cardinal`. Over-matching a
 * container is harmless: the innermost-wins pass below drops any element that
 * merely wraps another candidate, and a candidate with no sensible target is
 * simply left unlinked.
 */
const INTERACTIVE_CLASS =
  /(?:^|[\s_-])(?:card|btn|button|tab|nav|link|item|tile|row|cell|chip|pill|back|option|menu|thumb)(?:$|[\s_-])/i;

function isClickableCandidate(el: Element): boolean {
  if (el.matches(SEMANTIC_SELECTOR)) return true;
  const cls = el.getAttribute("class");
  if (cls && INTERACTIVE_CLASS.test(cls)) return true;
  const style = el.getAttribute("style");
  if (style && /cursor\s*:\s*pointer/i.test(style)) return true;
  return false;
}

/**
 * Parse a screen's `htmlContent`, find clickable elements — both semantic
 * (`a`, `button`, `[role="button"]`, `[onclick]`, `[tabindex]`) and the
 * non-semantic clickable-looking containers real design embeds use (cards,
 * tabs, nav rows via {@link INTERACTIVE_CLASS} or inline `cursor:pointer`) —
 * stamp each with a stable `data-proto-id`, and return a compact summary of
 * each candidate for the backend's link-graph LLM call (never the full HTML
 * — cheap on tokens). When candidates nest, only the innermost is kept so a
 * link never wraps a container in an `<a>` around an inner `<a>`.
 */
export function extractPrototypeCandidates(html: string): ExtractResult {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const candidates: PrototypeCandidate[] = [];
  const matched = Array.from(doc.querySelectorAll("*"))
    .filter(isClickableCandidate)
    // Never treat something inside an existing <a>/<button> as its own
    // candidate: the ancestor is the real clickable (an <a> gets its href
    // rewritten in place), and wrapping the inner element in a fresh <a>
    // would nest anchors — invalid HTML the browser silently unnests.
    .filter((el) => !el.parentElement?.closest("a, button"));
  // Innermost wins: drop any match that contains another match. This prevents
  // nested <a> on apply and gives per-item granularity (an individual `tab`,
  // not the whole `tab-bar`; a `button.back`, not its `nav` wrapper).
  const els = matched.filter((el) => !matched.some((other) => other !== el && el.contains(other)));
  els.forEach((el, i) => {
    const protoId = `p${i}`;
    el.setAttribute("data-proto-id", protoId);
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
    const cand: PrototypeCandidate = { protoId, tag: el.tagName.toLowerCase(), text };
    const aria = el.getAttribute("aria-label");
    if (aria) cand.ariaLabel = aria;
    const href = el.getAttribute("href");
    if (href) cand.href = href;
    const cls = el.getAttribute("class")?.trim();
    if (cls) cand.classHint = cls.replace(/\s+/g, " ").slice(0, MAX_TEXT);
    candidates.push(cand);
  });
  const contentText = (doc.body.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTENT_TEXT);

  return {
    annotatedHtml: doc.body.innerHTML,
    headHtml: doc.head.innerHTML,
    candidates,
    contentText,
  };
}
