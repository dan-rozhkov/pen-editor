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
}

const SELECTOR = 'a, button, [role="button"], [onclick]';
const MAX_TEXT = 80;

/**
 * Parse a screen's `htmlContent`, find clickable elements (`a`, `button`,
 * `[role="button"]`, `[onclick]`), stamp each with a stable `data-proto-id`,
 * and return a compact summary of each candidate for the backend's
 * link-graph LLM call (never the full HTML — cheap on tokens).
 */
export function extractPrototypeCandidates(html: string): ExtractResult {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const candidates: PrototypeCandidate[] = [];
  const els = Array.from(doc.querySelectorAll(SELECTOR));
  els.forEach((el, i) => {
    const protoId = `p${i}`;
    el.setAttribute("data-proto-id", protoId);
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
    const cand: PrototypeCandidate = { protoId, tag: el.tagName.toLowerCase(), text };
    const aria = el.getAttribute("aria-label");
    if (aria) cand.ariaLabel = aria;
    const href = el.getAttribute("href");
    if (href) cand.href = href;
    candidates.push(cand);
  });
  return {
    annotatedHtml: doc.body.innerHTML,
    headHtml: doc.head.innerHTML,
    candidates,
  };
}
