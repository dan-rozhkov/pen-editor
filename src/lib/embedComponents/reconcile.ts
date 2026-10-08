import { parseEmbedHtml, serializeEmbedDoc } from "@/lib/embedHtmlDocument";
import { rescopeCss } from "./css";
import { childRegions, closestRegion, ownSlots, parseMaster } from "./master";
import { readRegionSpec, renderRegionElement } from "./render";
import type { ComponentRegistry, ParsedMaster } from "./types";

/** Nested-component recursion limit; a cyclic registry stops here. */
const MAX_DEPTH = 12;

function parsedFor(registry: ComponentRegistry, key: string | null): ParsedMaster | null {
  if (!key) return null;
  const master = registry.get(key);
  return master ? parseMaster(master) : null;
}

/** Cheap text test: could this HTML contain anything reconcile touches? */
export function mayContainComponents(html: string): boolean {
  return html.includes("data-c=") || html.includes("data-c-style");
}

/** Region elements whose nearest enclosing region is none (top level). */
function topLevelRegions(container: Element): Element[] {
  return Array.from(container.querySelectorAll("[data-c]")).filter(
    (el) => closestRegion(el.parentElement) === null,
  );
}

/**
 * Re-render one region from its master. Returns the replacement element when
 * the final result (nested regions included) differs from `region`, else
 * null. A key with no valid master leaves the region as static HTML but
 * still reconciles regions nested in it.
 */
function reconcileRegion(
  region: Element,
  registry: ComponentRegistry,
  depth: number,
): Element | null {
  if (depth > MAX_DEPTH) return null;
  const parsed = parsedFor(registry, region.getAttribute("data-c"));
  if (!parsed) {
    // Static HTML: leave the region alone but still refresh regions nested in
    // it. Work on a clone so "unchanged" stays decidable by comparison.
    const copy = region.cloneNode(true) as Element;
    reconcileChildren(copy, registry, depth + 1);
    return copy.outerHTML === region.outerHTML ? null : copy;
  }
  const fresh = renderRegionElement(
    region.ownerDocument,
    parsed,
    readRegionSpec(region, parsed),
  );
  reconcileChildren(fresh, registry, depth + 1);
  return fresh.outerHTML === region.outerHTML ? null : fresh;
}

/** Reconcile each child region of `container` in place. */
function reconcileChildren(
  container: Element,
  registry: ComponentRegistry,
  depth: number,
): void {
  const regions = container.hasAttribute("data-c")
    ? childRegions(container)
    : topLevelRegions(container);
  for (const region of regions) {
    const replacement = reconcileRegion(region, registry, depth);
    if (replacement) region.replaceWith(replacement);
  }
}

/** Insert `el` in `<head>` right after the last `<head>` child matching `selector` (else first). */
function insertAfterLastInHead(doc: Document, el: Element, selector: string): void {
  const inHead = Array.from(doc.querySelectorAll(selector)).filter((s) => s.parentNode === doc.head);
  const anchor = inHead.length > 0 ? inHead[inHead.length - 1].nextSibling : doc.head.firstChild;
  doc.head.insertBefore(el, anchor);
}

function managedStyles(doc: Document): HTMLStyleElement[] {
  return Array.from(doc.querySelectorAll("style[data-c-style]")) as HTMLStyleElement[];
}

/** Add / update / remove the managed `<style data-c-style=key>` blocks. */
function syncManagedStyles(doc: Document, registry: ComponentRegistry): boolean {
  let changed = false;
  const used = new Set<string>();
  for (const el of Array.from(doc.body.querySelectorAll("[data-c]"))) {
    const key = el.getAttribute("data-c");
    if (key) used.add(key);
  }

  const seen = new Set<string>();
  for (const style of managedStyles(doc)) {
    const key = style.getAttribute("data-c-style") ?? "";
    const parsed = parsedFor(registry, key);
    if (!parsed) continue; // unknown key: static HTML keeps its CSS
    if (seen.has(key) || !used.has(key) || !parsed.css) {
      style.remove();
      changed = true;
      continue;
    }
    seen.add(key);
    const desired = `\n${parsed.css}\n`;
    if (style.textContent !== desired) {
      style.textContent = desired;
      changed = true;
    }
  }

  for (const key of [...used].sort()) {
    if (seen.has(key)) continue;
    const parsed = parsedFor(registry, key);
    if (!parsed || !parsed.css) continue;
    const style = doc.createElement("style");
    style.setAttribute("data-c-style", key);
    style.textContent = `\n${parsed.css}\n`;
    insertAfterLastInHead(doc, style, "style[data-c-style]");
    changed = true;
  }
  return changed;
}

/** Reconcile `doc` in place. Returns whether anything changed. */
function reconcileDoc(doc: Document, registry: ComponentRegistry): boolean {
  let changed = false;
  for (const region of topLevelRegions(doc.body)) {
    const replacement = reconcileRegion(region, registry, 0);
    if (replacement) {
      region.replaceWith(replacement);
      changed = true;
    }
  }
  if (syncManagedStyles(doc, registry)) changed = true;
  return changed;
}

/**
 * Bring every component region in `html` up to date with `registry`: each
 * region is re-rendered from its master (deepest regions last, slot content
 * preserved, a missing slot falls back to the master default), `data-c-rev`
 * is stamped, and the managed `<style data-c-style>` blocks are added with
 * the first instance and removed with the last. A region whose key has no
 * master stays as static HTML.
 *
 * The result keeps the input's fragment / body-only / full-document shape and
 * is the SAME string (identity) when nothing changed, so a no-op reconcile
 * never rewrites a screen. Idempotent: reconcile(reconcile(x)) === reconcile(x).
 */
export function reconcileHtml(html: string, registry: ComponentRegistry): string {
  if (!html || !mayContainComponents(html)) return html;
  const doc = parseEmbedHtml(html);
  if (!doc) return html;
  if (!reconcileDoc(doc, registry)) return html;
  return serializeEmbedDoc(html, doc);
}

/**
 * Cheap, DOM-free staleness check: is any registered region's `data-c-rev`
 * different from its master's current revision? Used to gate the lazy
 * catch-up so ordinary embed edits don't pay a DOM parse.
 */
export function hasStaleRegions(html: string, registry: ComponentRegistry): boolean {
  if (!html || !html.includes("data-c=") || registry.size === 0) return false;
  const tagRe = /<[a-zA-Z][^>]*?\sdata-c=(["'])([^"']+)\1[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const parsed = parsedFor(registry, m[2]);
    if (!parsed) continue;
    const rev = /\sdata-c-rev=(["'])([^"']*)\1/.exec(m[0])?.[2];
    if (rev !== parsed.rev) return true;
  }
  return false;
}

/** How many distinct keys appear as `data-c` regions in `html`. */
export function listRegionKeys(html: string): string[] {
  if (!html || !html.includes("data-c=")) return [];
  const keys = new Set<string>();
  const re = /<[a-zA-Z][^>]*?\sdata-c=(["'])([^"']+)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) keys.add(m[2]);
  return [...keys];
}

// ---------------------------------------------------------------------------
// Write guard
// ---------------------------------------------------------------------------

/** A region's managed zone as text: slot contents blanked, rev ignored. */
function managedSignature(region: Element): string {
  const clone = region.cloneNode(true) as Element;
  for (const slot of ownSlots(clone)) slot.innerHTML = "";
  clone.removeAttribute("data-c-rev");
  // Nested regions carry their own rev; ignore it everywhere inside.
  for (const nested of Array.from(clone.querySelectorAll("[data-c-rev]"))) {
    nested.removeAttribute("data-c-rev");
  }
  return clone.outerHTML;
}

export interface ManagedZoneViolation {
  key: string;
  message: string;
}

function violationFor(key: string): ManagedZoneViolation {
  return {
    key,
    message: `region \`${key}\` is component-managed; edit the master or detach it`,
  };
}

/**
 * Write guard. A write is a violation when it leaves a registered region
 * whose managed zone (everything outside its own slots) is not what the
 * master renders, AND that exact managed zone did not already exist in
 * `oldHtml` (so pre-existing drift, or an untouched stale region, never
 * blocks an unrelated edit). Slot edits, variant changes, inserting a
 * canonical region and deleting whole regions are all allowed.
 */
export function findManagedZoneViolation(
  oldHtml: string,
  newHtml: string,
  registry: ComponentRegistry,
): ManagedZoneViolation | null {
  if (oldHtml === newHtml || !mayContainComponents(newHtml) || registry.size === 0) return null;
  const newDoc = parseEmbedHtml(newHtml);
  if (!newDoc) return null;
  const oldDoc = oldHtml && mayContainComponents(oldHtml) ? parseEmbedHtml(oldHtml) : null;

  const oldSigs = new Set<string>();
  const oldStyles = new Set<string>();
  if (oldDoc) {
    for (const el of Array.from(oldDoc.body.querySelectorAll("[data-c]"))) {
      oldSigs.add(managedSignature(el));
    }
    for (const style of managedStyles(oldDoc)) oldStyles.add((style.textContent ?? "").trim());
  }

  for (const region of Array.from(newDoc.body.querySelectorAll("[data-c]"))) {
    const key = region.getAttribute("data-c");
    if (!parsedFor(registry, key)) continue;
    const expected = reconcileRegion(region, registry, 0) ?? region;
    const actualSig = managedSignature(region);
    if (actualSig !== managedSignature(expected) && !oldSigs.has(actualSig)) {
      return violationFor(key as string);
    }
  }

  for (const style of managedStyles(newDoc)) {
    const key = style.getAttribute("data-c-style") ?? "";
    const parsed = parsedFor(registry, key);
    if (!parsed) continue;
    const text = (style.textContent ?? "").trim();
    if (text !== parsed.css.trim() && !oldStyles.has(text)) return violationFor(key);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detach
// ---------------------------------------------------------------------------

function freshScope(doc: Document, key: string): string {
  const taken = new Set<string>();
  for (const el of Array.from(doc.querySelectorAll("[data-d]"))) {
    taken.add(el.getAttribute("data-d") ?? "");
  }
  for (const el of Array.from(doc.querySelectorAll("style[data-d-style]"))) {
    taken.add(el.getAttribute("data-d-style") ?? "");
  }
  let n = 1;
  while (taken.has(`${key}-${n}`)) n++;
  return `${key}-${n}`;
}

function cssForKey(doc: Document, key: string, registry: ComponentRegistry): string {
  const parsed = parsedFor(registry, key);
  if (parsed) return parsed.css;
  const existing = managedStyles(doc).find((s) => s.getAttribute("data-c-style") === key);
  return (existing?.textContent ?? "").trim();
}

function insertDetachedStyle(doc: Document, scope: string, css: string): void {
  const style = doc.createElement("style");
  style.setAttribute("data-d-style", scope);
  style.textContent = `\n${css}\n`;
  insertAfterLastInHead(doc, style, "style[data-d-style]");
}

/** Strip the component markers from `region`, keeping it renderable. */
function detachElement(region: Element, scope: string | null): void {
  for (const slot of ownSlots(region)) slot.removeAttribute("data-c-slot");
  region.removeAttribute("data-c");
  region.removeAttribute("data-c-rev");
  if (scope) region.setAttribute("data-d", scope);
}

export interface DetachResult {
  html: string;
  /** Number of regions detached. */
  detached: number;
}

/**
 * Detach component regions: the HTML stays, the markers go. The master's CSS
 * is kept alive for the detached element(s) as a static `<style
 * data-d-style>` re-scoped to `[data-d="<key>-<n>"]` (the managed block
 * would be dropped with the last instance, and the element must not change
 * appearance).
 *
 * `select` picks the regions: all of one key, or the single region a CSS
 * selector resolves to (the element itself or its closest enclosing region).
 */
export function detachRegions(
  html: string,
  registry: ComponentRegistry,
  select: { key: string } | { selector: string },
): DetachResult {
  const doc = html && mayContainComponents(html) ? parseEmbedHtml(html) : null;
  if (!doc) return { html, detached: 0 };

  let targets: Element[];
  if ("key" in select) {
    targets = Array.from(doc.body.querySelectorAll("[data-c]")).filter(
      (el) => el.getAttribute("data-c") === select.key,
    );
  } else {
    let hit: Element | null = null;
    try {
      hit = doc.querySelector(select.selector);
    } catch {
      hit = null;
    }
    const region = hit && (hit.hasAttribute("data-c") ? hit : closestRegion(hit));
    targets = region ? [region] : [];
  }
  if (targets.length === 0) return { html, detached: 0 };

  const scopes = new Map<string, string>();
  for (const el of targets) {
    const key = el.getAttribute("data-c") ?? "";
    const css = cssForKey(doc, key, registry);
    let scope: string | null = null;
    if (css) {
      // One scope per key per call: the CSS is identical for every copy.
      scope = scopes.get(key) ?? null;
      if (!scope) {
        scope = freshScope(doc, key);
        scopes.set(key, scope);
        insertDetachedStyle(doc, scope, rescopeCss(css, key, scope));
      }
    }
    detachElement(el, scope);
  }

  // The managed block for a key with no regions left goes away.
  const remaining = new Set(
    Array.from(doc.body.querySelectorAll("[data-c]")).map((el) => el.getAttribute("data-c")),
  );
  for (const style of managedStyles(doc)) {
    const key = style.getAttribute("data-c-style");
    if (key && !remaining.has(key) && scopes.has(key)) style.remove();
  }
  return { html: serializeEmbedDoc(html, doc), detached: targets.length };
}
