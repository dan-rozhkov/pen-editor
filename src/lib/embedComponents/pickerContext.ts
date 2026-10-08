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

function regionOf(el: Element): { region: Element; zone: "managed" | "slot" } | null {
  let slot = false;
  let cur: Element | null = el;
  while (cur && cur.tagName !== "BODY") {
    if (cur.hasAttribute("data-c")) return { region: cur, zone: slot ? "slot" : "managed" };
    if (cur.hasAttribute("data-c-slot")) slot = true;
    cur = cur.parentElement;
  }
  return null;
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
 * Add `<c-KEY></c-KEY>` to an embed's HTML: right after the picked element
 * (after its whole region when the pick is inside a managed zone, so the
 * write guard never sees a change inside a managed zone), else at the end
 * of `<body>`. The caller runs the result through `finalizeEmbedHtml`, which
 * expands the tag.
 */
export function insertInstanceTag(html: string, key: string, anchorShadowPath?: string | null): string | null {
  const doc = parseEmbedHtml(html);
  if (!doc?.body) return null;
  const tag = doc.createElement(`c-${key}`);
  let anchor: Element | null = null;
  const sourcePath = anchorShadowPath ? normalizeShadowPathToSourcePath(anchorShadowPath, html) : null;
  const picked = sourcePath ? resolveElementPath(doc.body, sourcePath) : null;
  if (picked) {
    const found = regionOf(picked);
    anchor = found?.zone === "managed" ? found.region : picked;
  }
  if (anchor && anchor !== doc.body) anchor.after(tag);
  else doc.body.append(tag);
  return serializeEmbedDoc(html, doc);
}
