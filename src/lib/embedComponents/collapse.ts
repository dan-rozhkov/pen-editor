import { expandComponentTags } from "./expand";
import { closestRegion, ownSlots, parseMaster } from "./master";
import { mayContainComponents, reconcileHtml } from "./reconcile";
import { readRegionSpec } from "./render";
import type { ComponentRegistry, ParsedMaster } from "./types";

/** Escape a value for a double-quoted attribute; `decodeAttr` in expand reads it back. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseBody(html: string): Element {
  return new DOMParser().parseFromString(html, "text/html").body;
}

/** slot name -> the master's default inner HTML. */
function defaultSlots(parsed: ParsedMaster): Record<string, string> {
  const template = document.createElement("template");
  template.innerHTML = parsed.rootHtml;
  const root = template.content.firstElementChild;
  const out: Record<string, string> = {};
  if (!root) return out;
  for (const slot of ownSlots(root)) {
    const name = slot.getAttribute("data-c-slot") ?? "";
    if (name && !(name in out)) out[name] = slot.innerHTML;
  }
  return out;
}

/** The tag form of one region, or null when it cannot be written as a tag. */
function regionToTag(region: Element, registry: ComponentRegistry, parsedByKey: Map<string, ParsedMaster | null>): string | null {
  const key = region.getAttribute("data-c") ?? "";
  if (!registry.has(key)) return null;
  let parsed = parsedByKey.get(key);
  if (parsed === undefined) {
    parsed = parseMaster(registry.get(key)!);
    parsedByKey.set(key, parsed);
  }
  if (!parsed) return null;

  const spec = readRegionSpec(region, parsed);
  let attrs = "";
  for (const [axis, value] of Object.entries(spec.variants ?? {})) {
    if (parsed.axes[axis] !== value) attrs += ` ${axis}="${escapeAttr(value)}"`;
  }
  if (spec.attrs?.id) attrs += ` id="${escapeAttr(spec.attrs.id)}"`;
  if (spec.attrs?.style) attrs += ` style="${escapeAttr(spec.attrs.style)}"`;

  const defaults = defaultSlots(parsed);
  const changed: Array<[string, string]> = [];
  for (const [name, content] of Object.entries(spec.slots ?? {})) {
    if (content !== defaults[name]) changed.push([name, collapseFragment(content, registry, parsedByKey)]);
  }

  let body = "";
  if (changed.length === 1 && changed[0][0] === parsed.slots[0] && changed[0][1].trim() !== "") {
    body = changed[0][1];
  } else {
    body = changed.map(([name, content]) => `<c-slot name="${escapeAttr(name)}">${content}</c-slot>`).join("");
  }
  const tag = body ? `<c-${key}${attrs}>${body}</c-${key}>` : `<c-${key}${attrs} />`;

  // Only a tag that expands back to exactly this region may replace it.
  const probe = parseBody(expandComponentTags(tag, registry).html);
  const back = Array.from(probe.querySelectorAll("[data-c]")).find((el) => closestRegion(el.parentElement) === null);
  return back && back.outerHTML === region.outerHTML ? tag : null;
}

/** Collapse the top-level canonical regions of an HTML string; other text is untouched. */
function collapseFragment(html: string, registry: ComponentRegistry, parsedByKey: Map<string, ParsedMaster | null>): string {
  if (!mayContainComponents(html)) return html;
  const body = parseBody(html);
  const regions = Array.from(body.querySelectorAll("[data-c]")).filter(
    (el) => closestRegion(el.parentElement) === null,
  );
  let out = "";
  let cursor = 0;
  for (const region of regions) {
    const source = region.outerHTML;
    const at = html.indexOf(source, cursor);
    if (at === -1) continue;
    const tag = regionToTag(region, registry, parsedByKey);
    if (tag === null) continue;
    out += html.slice(cursor, at) + tag;
    cursor = at + source.length;
  }
  return out + html.slice(cursor);
}

function stripManagedStyles(html: string): string {
  return html.replace(/[ \t]*<style\b[^>]*\bdata-c-style="[^"]*"[^>]*>[\s\S]*?<\/style>[ \t]*\r?\n?/gi, "");
}

/**
 * The compact view of stored embed HTML: every region that equals
 * `render(master, variants, slots, attrs)` becomes `<c-KEY variant="v">` with
 * `<c-slot name>` children (bare content for a single default slot), and the
 * managed `<style data-c-style>` blocks are dropped. A region that was edited
 * by hand stays expanded.
 *
 * Invariant: `expandComponentTags(collapse(h)).html === h` for reconciled `h`
 * (any other `h` compares equal after reconcile). It is checked here; when it
 * cannot be kept the input comes back unchanged.
 */
export function collapseComponentRegions(html: string, registry: ComponentRegistry): string {
  if (registry.size === 0 || !mayContainComponents(html)) return html;
  const collapsed = collapseFragment(html, registry, new Map());
  if (collapsed === html) return html;
  const stripped = stripManagedStyles(collapsed);
  // Expanding always reconciles, so a stale or hand-edited region comes back
  // reconciled; the baseline is therefore the reconciled input.
  const baseline = reconcileHtml(html, registry);
  if (expandComponentTags(stripped, registry).html === baseline) return stripped;
  if (expandComponentTags(collapsed, registry).html === baseline) return collapsed;
  return html;
}
