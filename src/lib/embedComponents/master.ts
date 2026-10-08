import { parseEmbedHtml } from "@/lib/embedHtmlDocument";
import { scopeCss } from "./css";
import type { ComponentMaster, ParsedMaster } from "./types";
import { isValidComponentKey } from "./types";

const VARIANT_ATTR_PREFIX = "data-v-";
const SLOT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const AXIS_PATTERN = /^[a-z][a-z0-9-]*$/;

export type ValidateMasterResult =
  | { ok: true; master: ParsedMaster }
  | { ok: false; errors: string[] };

/** FNV-1a 32-bit, hex. Enough to tell two master texts apart. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function variantsSignature(variants: Record<string, string[]> | undefined): string {
  if (!variants) return "";
  const keys = Object.keys(variants).sort();
  return JSON.stringify(keys.map((k) => [k, variants[k]]));
}

/** Names of the variant axes a root element declares (`data-v-*` attrs). */
export function readAxes(root: Element): Record<string, string> {
  const axes: Record<string, string> = {};
  for (const attr of Array.from(root.attributes)) {
    if (attr.name.startsWith(VARIANT_ATTR_PREFIX)) {
      axes[attr.name.slice(VARIANT_ATTR_PREFIX.length)] = attr.value;
    }
  }
  return axes;
}

/** The nearest ancestor-or-self carrying `data-c`. */
export function closestRegion(el: Element | null): Element | null {
  return el ? el.closest("[data-c]") : null;
}

/** Slot elements that belong to `region` itself (not to a nested region). */
export function ownSlots(region: Element): Element[] {
  return Array.from(region.querySelectorAll("[data-c-slot]")).filter(
    (el) => closestRegion(el) === region,
  );
}

/** Regions nested inside `region` whose nearest enclosing region is `region`. */
export function childRegions(region: Element): Element[] {
  return Array.from(region.querySelectorAll("[data-c]")).filter(
    (el) => closestRegion(el.parentElement) === region,
  );
}

/**
 * Validate a master's HTML and normalize it:
 * - exactly one root element, `data-c="<key>"` (set when absent, error when
 *   it names another key);
 * - every `<style>` is merged into one block whose selectors all start with
 *   `[data-c="<key>"]` (bare selectors are prefixed);
 * - the root's own `style` attr stays on the root (inline precedence; an
 *   instance's `style` is merged after it and wins), its `id` and
 *   `data-c-rev` are dropped, so an instance's `id` is purely the instance's;
 * - slots (`data-c-slot`) and variant axes (`data-v-*` on the root, plus
 *   `variants` from the meta) are collected.
 */
export function validateMaster(
  html: string,
  key: string,
  variantsMeta?: Record<string, string[]>,
): ValidateMasterResult {
  const errors: string[] = [];
  if (!isValidComponentKey(key)) {
    return {
      ok: false,
      errors: [`key "${String(key)}" must match /^[a-z][a-z0-9-]{0,39}$/ and not be "slot"`],
    };
  }
  const doc = typeof html === "string" ? parseEmbedHtml(html) : null;
  if (!doc) return { ok: false, errors: ["html could not be parsed"] };

  // Managed blocks of NESTED components (written by expansion) belong to the
  // consuming embed, never to this master: drop them unread.
  for (const managed of Array.from(doc.querySelectorAll("style[data-c-style]"))) managed.remove();
  const styleEls = Array.from(doc.querySelectorAll("style"));
  const cssParts = styleEls.map((s) => s.textContent ?? "");
  for (const s of styleEls) s.remove();

  const bodyChildren = Array.from(doc.body.childNodes).filter((n) => {
    if (n.nodeType === 8) return false; // comment
    if (n.nodeType === 3) return (n.textContent ?? "").trim().length > 0;
    return true;
  });
  const roots = bodyChildren.filter((n) => n.nodeType === 1) as Element[];
  if (bodyChildren.length !== 1 || roots.length !== 1) {
    errors.push(
      `a master needs exactly one root element (found ${bodyChildren.length} top-level nodes besides <style>)`,
    );
    return { ok: false, errors };
  }
  const root = roots[0];
  if (root.tagName === "SCRIPT") {
    return { ok: false, errors: ["the root element cannot be a <script>"] };
  }

  const declaredKey = root.getAttribute("data-c");
  if (declaredKey && declaredKey !== key) {
    errors.push(`root has data-c="${declaredKey}" but the component key is "${key}"`);
  }
  root.setAttribute("data-c", key);
  root.removeAttribute("id");
  root.removeAttribute("data-c-rev");
  root.removeAttribute("data-c-ms");
  // The root's inline style stays ON the root (inline precedence); a rendered
  // instance merges its own style after it (see render.ts).
  const rootStyle = (root.getAttribute("style") ?? "").trim();
  if (rootStyle) root.setAttribute("style", rootStyle);
  else root.removeAttribute("style");

  // Slots
  const slots: string[] = [];
  for (const el of ownSlots(root)) {
    const name = el.getAttribute("data-c-slot") ?? "";
    if (!SLOT_NAME_PATTERN.test(name)) {
      errors.push(`slot name "${name}" must match /^[A-Za-z][A-Za-z0-9_-]*$/`);
    } else if (slots.includes(name)) {
      errors.push(`slot "${name}" is declared twice`);
    } else {
      slots.push(name);
    }
  }
  if (root.hasAttribute("data-c-slot")) {
    errors.push("the root element cannot itself be a slot");
  }

  // Variant axes: root attributes first, then declared-only axes from meta.
  const axes = readAxes(root);
  for (const axis of Object.keys(axes)) {
    if (!AXIS_PATTERN.test(axis)) errors.push(`variant axis "${axis}" must match /^[a-z][a-z0-9-]*$/`);
  }
  for (const [axis, values] of Object.entries(variantsMeta ?? {})) {
    if (!AXIS_PATTERN.test(axis)) {
      errors.push(`variant axis "${axis}" must match /^[a-z][a-z0-9-]*$/`);
      continue;
    }
    if (!Array.isArray(values) || values.length === 0) {
      errors.push(`variant axis "${axis}" needs at least one value`);
      continue;
    }
    if (!(axis in axes)) {
      axes[axis] = values[0];
      root.setAttribute(VARIANT_ATTR_PREFIX + axis, values[0]);
    }
  }

  // Nested components
  const nested: string[] = [];
  for (const el of Array.from(root.querySelectorAll("[data-c]"))) {
    const nestedKey = el.getAttribute("data-c") ?? "";
    if (nestedKey === key) errors.push(`component "${key}" cannot contain itself`);
    else if (nestedKey && !nested.includes(nestedKey)) nested.push(nestedKey);
  }

  if (errors.length > 0) return { ok: false, errors };

  const css = scopeCss(cssParts.join("\n"), key);
  const rootHtml = root.outerHTML;
  const normalized = css ? `<style>\n${css}\n</style>\n${rootHtml}` : rootHtml;
  const rev = shortHash(normalized + "\u0000" + variantsSignature(variantsMeta));
  return {
    ok: true,
    master: {
      key,
      css,
      rootHtml,
      rootTag: root.tagName.toLowerCase(),
      rootStyle,
      axes,
      slots,
      nested,
      html: normalized,
      rev,
    },
  };
}

const parseCache = new Map<string, ParsedMaster | null>();
const PARSE_CACHE_LIMIT = 300;

/** Parse a registry master; null when its stored HTML no longer validates. */
export function parseMaster(master: ComponentMaster): ParsedMaster | null {
  const cacheKey = `${master.key}\u0000${master.html}\u0000${variantsSignature(master.meta.variants)}`;
  if (parseCache.has(cacheKey)) return parseCache.get(cacheKey) ?? null;
  const result = validateMaster(master.html, master.key, master.meta.variants);
  const parsed = result.ok ? result.master : null;
  if (parseCache.size >= PARSE_CACHE_LIMIT) parseCache.clear();
  parseCache.set(cacheKey, parsed);
  return parsed;
}

/** Revision stamp of a master (`data-c-rev` of every up-to-date region). */
export function computeRev(master: ComponentMaster): string {
  return parseMaster(master)?.rev ?? shortHash(master.html);
}

/** axis -> allowed values, merging the meta with the root's declared axes. */
export function effectiveVariants(
  master: ComponentMaster,
  parsed: ParsedMaster,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [axis, def] of Object.entries(parsed.axes)) {
    const declared = master.meta.variants?.[axis];
    out[axis] = declared && declared.length > 0 ? [...declared] : [def];
  }
  return out;
}
