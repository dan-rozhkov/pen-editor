import { parseEmbedHtml, serializeEmbedDoc } from "@/lib/embedHtmlDocument";
import { filterCssRules } from "./css";
import { renderRegionElement } from "./render";
import type { ParsedMaster } from "./types";

/** Elements whose text is never turned into a slot. */
const OPAQUE_TAGS = new Set(["SCRIPT", "STYLE", "SVG", "TEXTAREA", "SELECT", "OPTION"]);

function isInsideOpaque(el: Element, boundary: Element): boolean {
  for (let cur: Element | null = el; cur && cur !== boundary.parentElement; cur = cur.parentElement) {
    if (OPAQUE_TAGS.has(cur.tagName.toUpperCase())) return true;
  }
  return false;
}

/** Text-only leaves of `root`, in document order (the elements that become slots). */
function textLeaves(root: Element): Element[] {
  const leaves: Element[] = [];
  const visit = (el: Element) => {
    if (OPAQUE_TAGS.has(el.tagName.toUpperCase())) return;
    if (el.children.length === 0) {
      if ((el.textContent ?? "").trim().length > 0 && !isInsideOpaque(el, root)) leaves.push(el);
      return;
    }
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(root);
  return leaves;
}

function slotName(index: number): string {
  return index === 0 ? "text" : `text-${index + 1}`;
}

/** Component / detach markers: engine bookkeeping, never part of an element's identity. */
const MARKER_ATTR = /^data-(c|c-.+|v-.+|d|d-.+)$/;

/**
 * Structural fingerprint: tag + sorted attributes (minus `id` and the
 * component markers `data-c*`, `data-v-*`, `data-d*`; other `data-*` count
 * by name AND value) +
 * children, with each text-only leaf reduced to a placeholder so two
 * elements that differ only in their text compare equal.
 */
export function structuralSignature(el: Element): string {
  const attrs = Array.from(el.attributes)
    .filter((a) => a.name !== "id" && !MARKER_ATTR.test(a.name))
    .map((a) => `${a.name}=${a.value}`)
    .sort()
    .join(";");
  const tag = el.tagName.toLowerCase();
  if (el.children.length === 0) {
    return (el.textContent ?? "").trim() ? `<${tag} ${attrs}>#t</${tag}>` : `<${tag} ${attrs}/>`;
  }
  const inner = Array.from(el.childNodes)
    .map((n) => {
      if (n.nodeType === 1) return structuralSignature(n as Element);
      if (n.nodeType === 3) return (n.textContent ?? "").trim();
      return "";
    })
    .join("");
  return `<${tag} ${attrs}>${inner}</${tag}>`;
}

export interface Extraction {
  /** Raw master HTML (`<style>` + marked-up root), ready for `validateMaster`. */
  masterHtml: string;
  /** Slot name -> content, as found in the extracted element. */
  slots: Record<string, string>;
  /** The element's own id, to carry onto its instance. */
  id: string | null;
  signature: string;
  tag: string;
}

export type ExtractResult = { ok: true; extraction: Extraction } | { ok: false; error: string };

function collectScreenCss(doc: Document): string {
  return Array.from(doc.querySelectorAll("style"))
    .filter((s) => !s.hasAttribute("data-c-style") && !s.hasAttribute("data-d-style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
}

/**
 * Turn the element `selector` resolves to into a master draft: the element's
 * markup becomes the root (marked `data-c=key`), every text-only leaf becomes
 * a slot (`text`, `text-2`, ...), and the screen's own CSS rules that match
 * the element or a descendant are carried over. Rules that depend on an
 * ancestor outside the element cannot be carried: the master scopes them
 * under its own root.
 */
export function extractMasterDraft(html: string, selector: string, key: string): ExtractResult {
  const doc = parseEmbedHtml(html);
  if (!doc) return { ok: false, error: "html could not be parsed" };
  let el: Element | null;
  try {
    el = doc.querySelector(selector);
  } catch {
    return { ok: false, error: `invalid selector: ${selector}` };
  }
  if (!el) return { ok: false, error: `selector matched nothing: ${selector}` };
  if (el === doc.body || el === doc.documentElement || el === doc.head) {
    return { ok: false, error: "select an element inside the body, not the document" };
  }
  if (el.closest("[data-c]")) {
    return { ok: false, error: "the element is already part of a component instance" };
  }

  const signature = structuralSignature(el);
  const slots: Record<string, string> = {};

  const clone = el.cloneNode(true) as Element;
  const cloneLeaves = textLeaves(clone);
  // A root that is itself a text leaf gets its text wrapped, so the root is
  // never the slot.
  if (cloneLeaves.length === 1 && cloneLeaves[0] === clone) {
    const span = clone.ownerDocument.createElement("span");
    span.innerHTML = clone.innerHTML;
    clone.replaceChildren(span);
    span.setAttribute("data-c-slot", slotName(0));
    slots[slotName(0)] = span.innerHTML;
  } else {
    cloneLeaves.forEach((leaf, i) => {
      leaf.setAttribute("data-c-slot", slotName(i));
      slots[slotName(i)] = leaf.innerHTML;
    });
  }

  const matchesInside = (selectorText: string): boolean => {
    // Drop pseudo-classes / pseudo-elements so `.btn:hover` counts as `.btn`.
    const bare = selectorText.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, "").trim() || "*";
    try {
      return el.matches(bare) || el.querySelector(bare) !== null;
    } catch {
      return false;
    }
  };
  const css = filterCssRules(collectScreenCss(doc), matchesInside);

  clone.setAttribute("data-c", key);
  const id = el.getAttribute("id");
  clone.removeAttribute("id");
  const masterHtml = css ? `<style>\n${css}\n</style>\n${clone.outerHTML}` : clone.outerHTML;
  return {
    ok: true,
    extraction: { masterHtml, slots, id, signature, tag: el.tagName.toLowerCase() },
  };
}

/** Slot values of `el` in the order `extractMasterDraft` numbered them. */
function readSlots(el: Element): Record<string, string> {
  const slots: Record<string, string> = {};
  const leaves = textLeaves(el);
  if (leaves.length === 1 && leaves[0] === el) {
    slots[slotName(0)] = el.innerHTML;
    return slots;
  }
  leaves.forEach((leaf, i) => {
    slots[slotName(i)] = leaf.innerHTML;
  });
  return slots;
}

export interface ReplaceResult {
  html: string;
  replaced: number;
}

/**
 * Replace elements of `html` with instances of `master`.
 *  - `selector` set: exactly the element it resolves to (the origin).
 *  - `similarTo` set: every top-level element whose structural signature
 *    equals it (skipping anything already inside a component region).
 * Each instance takes the element's text leaves as its slots and keeps its id.
 */
export function replaceWithInstances(
  html: string,
  parsed: ParsedMaster,
  target: { selector: string } | { similarTo: string; tag: string },
): ReplaceResult {
  const doc = parseEmbedHtml(html);
  if (!doc) return { html, replaced: 0 };

  let elements: Element[];
  if ("selector" in target) {
    let hit: Element | null = null;
    try {
      hit = doc.querySelector(target.selector);
    } catch {
      hit = null;
    }
    elements = hit ? [hit] : [];
  } else {
    elements = Array.from(doc.body.querySelectorAll(target.tag)).filter(
      (el) => !el.closest("[data-c]") && structuralSignature(el) === target.similarTo,
    );
  }

  let replaced = 0;
  for (const el of elements) {
    if (!el.isConnected) continue; // inside an element replaced earlier
    const region = renderRegionElement(doc, parsed, {
      slots: readSlots(el),
      attrs: el.getAttribute("id") ? { id: el.getAttribute("id") as string } : undefined,
    });
    el.replaceWith(region);
    replaced++;
  }
  return replaced > 0 ? { html: serializeEmbedDoc(html, doc), replaced } : { html, replaced: 0 };
}
