import { buildElementPath, resolveElementPath } from "@/lib/embedElementPicker";
import { normalizeShadowPathToSourcePath } from "@/lib/embedLayerTree";
import { parseEmbedHtml, serializeEmbedDoc } from "@/lib/embedHtmlDocument";

/** Where a picked element sits relative to a component region. */
export interface PickedRegion {
  key: string;
  /**
   * `managed`: the region root or anything in it outside a slot; only the
   * master controls it. `slot`: inside a slot element; the instance owns it.
   */
  zone: "managed" | "slot";
  /** CSS selector from the document root to the region root (for `detach_instance`). */
  regionSelector: string;
  /** Source path of the region root, relative to `<body>`. */
  regionPath: string;
}

/**
 * Classify `el` against its enclosing regions. Returns the OUTERMOST region
 * whose managed zone holds `el` (a slot of an outer region frees `el` from
 * that region, so a nested instance inside a slot is judged on its own). When
 * every enclosing region only holds `el` in a slot, returns the innermost
 * region with zone `slot`; null when `el` is in no region.
 */
function regionOf(el: Element): { region: Element; zone: "managed" | "slot" } | null {
  const chain: Element[] = [];
  for (let cur: Element | null = el; cur && cur.tagName !== "BODY"; cur = cur.parentElement) chain.push(cur);
  let outermostManaged: Element | null = null;
  let innermost: Element | null = null;
  chain.forEach((candidate, i) => {
    if (!candidate.hasAttribute("data-c")) return;
    innermost ??= candidate;
    // Is `el` in a slot that belongs to `candidate`? (slot elements between el and candidate)
    const inOwnSlot = chain
      .slice(0, i)
      .some((n) => n.hasAttribute("data-c-slot") && n.parentElement?.closest("[data-c]") === candidate);
    if (!inOwnSlot) outermostManaged = candidate;
  });
  if (outermostManaged) return { region: outermostManaged, zone: "managed" };
  return innermost ? { region: innermost, zone: "slot" } : null;
}

/** Parents that take block-level flow content. */
const FLOW_PARENTS = new Set([
  "DIV", "SECTION", "MAIN", "ARTICLE", "ASIDE", "HEADER", "FOOTER", "NAV", "FORM", "LI", "BLOCKQUOTE",
  "FIGURE", "DETAILS", "DIALOG", "FIELDSET", "TD", "TH", "BODY",
]);
/** A flow parent inside one of these cannot take a block-level instance. */
const INLINE_CONTEXT = "p,span,a,button,svg,select,label,h1,h2,h3,h4,h5,h6,ul,ol,table";

function acceptsFlow(parent: Element): boolean {
  if (parent.tagName === "BODY") return true;
  if (!FLOW_PARENTS.has(parent.tagName)) return false;
  // `li` and table cells are the content slots of ul/ol and table.
  const outer = parent.parentElement?.closest(INLINE_CONTEXT);
  if (!outer) return true;
  return (outer.tagName === "UL" || outer.tagName === "OL" || outer.tagName === "TABLE") &&
    !outer.parentElement?.closest("p,span,a,button,svg,select,label,h1,h2,h3,h4,h5,h6");
}

/** Climb from `start` to the nearest element after which a block-level instance may go. */
function flowAnchor(start: Element): Element {
  let anchor = start;
  for (let guard = 0; guard < 1000; guard++) {
    const found = regionOf(anchor);
    if (found?.zone === "managed") anchor = found.region;
    const parent = anchor.parentElement;
    if (!parent || parent.tagName === "BODY") return anchor;
    if (acceptsFlow(parent) && regionOf(parent)?.zone !== "managed") return anchor;
    anchor = parent;
  }
  return anchor;
}

function resolvePicked(html: string, shadowPath: string): { doc: Document; el: Element } | null {
  const sourcePath = normalizeShadowPathToSourcePath(shadowPath, html);
  if (!sourcePath) return null;
  const doc = parseEmbedHtml(html);
  if (!doc?.body) return null;
  const el = resolveElementPath(doc.body, sourcePath);
  return el ? { doc, el } : null;
}

/**
 * Classify a picked element (by its shadow-DOM path) against the stored
 * `htmlContent`: inside a component region or not, and in its managed zone
 * or in a slot. Null when the path is stale or the element is plain HTML.
 */
export function findPickedComponentRegion(html: string, shadowPath: string): PickedRegion | null {
  if (!html.includes("data-c")) return null;
  const hit = resolvePicked(html, shadowPath);
  if (!hit) return null;
  const found = regionOf(hit.el);
  if (!found) return null;
  const key = found.region.getAttribute("data-c") ?? "";
  if (!key) return null;
  const regionPath = buildElementPath(found.region, hit.doc.body, { anchorOnId: false });
  return { key, zone: found.zone, regionPath, regionSelector: `body > ${regionPath}` };
}

/**
 * Add `<c-KEY></c-KEY>` to an embed's HTML at a block-level flow position:
 * after the picked element, climbing to the nearest ancestor whose parent
 * takes flow content (never inside inline text, svg, a list or table except
 * as `li`/cell content, a select, a button or a link, and never inside a
 * managed zone), else at the end of `<body>`. The caller runs the result through `finalizeEmbedHtml`, which
 * expands the tag.
 */
export function insertInstanceTag(html: string, key: string, anchorShadowPath?: string | null): string | null {
  const doc = parseEmbedHtml(html);
  if (!doc?.body) return null;
  const tag = doc.createElement(`c-${key}`);
  let anchor: Element | null = null;
  const sourcePath = anchorShadowPath ? normalizeShadowPathToSourcePath(anchorShadowPath, html) : null;
  const picked = sourcePath ? resolveElementPath(doc.body, sourcePath) : null;
  if (picked) anchor = flowAnchor(picked);
  if (anchor && anchor !== doc.body) anchor.after(tag);
  else doc.body.append(tag);
  return serializeEmbedDoc(html, doc);
}
