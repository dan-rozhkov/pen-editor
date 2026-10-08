import { expandComponentTags, mentionsRegisteredTag } from "./expand";
import { parseMaster } from "./master";
import { mayContainComponents, reconcileHtml, topLevelRegions } from "./reconcile";
import { readRegionSpec, renderRegionElement } from "./render";
import type { ComponentRegistry, ParsedMaster } from "./types";

/** Escape a value for a double-quoted attribute; `decodeAttr` in expand reads it back. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseBody(html: string): Element {
  return new DOMParser().parseFromString(html, "text/html").body;
}

interface MasterInfo {
  parsed: ParsedMaster;
  /** The master's default slot contents (slot name -> inner HTML). */
  defaultSlots: Record<string, string>;
}

/** Per-call cache: each master is parsed once, however many regions use it. */
type MasterCache = Map<string, MasterInfo | null>;

function masterInfo(key: string, registry: ComponentRegistry, cache: MasterCache): MasterInfo | null {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const master = registry.get(key);
  const parsed = master ? parseMaster(master) : null;
  let info: MasterInfo | null = null;
  if (parsed) {
    const template = document.createElement("template");
    template.innerHTML = parsed.rootHtml;
    const root = template.content.firstElementChild;
    info = { parsed, defaultSlots: root ? (readRegionSpec(root, parsed).slots ?? {}) : {} };
  }
  cache.set(key, info);
  return info;
}

/** The tag form of one region, or null when it cannot be written as a tag. */
function regionToTag(region: Element, registry: ComponentRegistry, cache: MasterCache): string | null {
  const key = region.getAttribute("data-c") ?? "";
  const info = masterInfo(key, registry, cache);
  if (!info) return null;
  const { parsed, defaultSlots } = info;

  // Only a region that IS render(master, spec) may become a tag.
  const spec = readRegionSpec(region, parsed);
  if (renderRegionElement(region.ownerDocument, parsed, spec).outerHTML !== region.outerHTML) return null;

  let attrs = "";
  for (const [axis, value] of Object.entries(spec.variants ?? {})) {
    if (parsed.axes[axis] !== value) attrs += ` ${axis}="${escapeAttr(value)}"`;
  }
  if (spec.attrs?.id) attrs += ` id="${escapeAttr(spec.attrs.id)}"`;
  if (spec.attrs?.style) attrs += ` style="${escapeAttr(spec.attrs.style)}"`;

  // Slot text is always written, so it stays greppable and editable. Only an
  // empty slot whose master default is empty too is left out.
  const written: Array<[string, string]> = [];
  for (const [name, content] of Object.entries(spec.slots ?? {})) {
    if (content === "" && (defaultSlots[name] ?? "") === "") continue;
    written.push([name, collapseFragment(content, registry, cache)]);
  }

  let body: string;
  if (written.length === 1 && written[0][0] === parsed.slots[0] && written[0][1].trim() !== "") {
    body = written[0][1];
  } else {
    body = written.map(([name, content]) => `<c-slot name="${escapeAttr(name)}">${content}</c-slot>`).join("");
  }
  return body ? `<c-${key}${attrs}>${body}</c-${key}>` : `<c-${key}${attrs} />`;
}

/** Collapse the top-level canonical regions of an HTML string; other text is untouched. */
function collapseFragment(html: string, registry: ComponentRegistry, cache: MasterCache): string {
  if (!mayContainComponents(html)) return html;
  const regions = topLevelRegions(parseBody(html));
  let out = "";
  let cursor = 0;
  for (const region of regions) {
    const source = region.outerHTML;
    const at = html.indexOf(source, cursor);
    if (at === -1) continue;
    const tag = regionToTag(region, registry, cache);
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
 * its slot content (bare for a single first slot, `<c-slot name>` children
 * otherwise), and the managed `<style data-c-style>` blocks are dropped. A
 * region that was edited by hand stays expanded. Raw `<c-key>` tags of keys
 * registered after they were written are expanded first, as the sync does.
 *
 * Invariant: `expandComponentTags(collapse(h)).html === h` for reconciled `h`
 * (any other `h` compares equal after reconcile). It is checked here; when it
 * cannot be kept the input comes back unchanged (`result === html`).
 */
export function collapseComponentRegions(html: string, registry: ComponentRegistry): string {
  if (registry.size === 0) return html;
  const base = mentionsRegisteredTag(html, registry) ? expandComponentTags(html, registry).html : html;
  if (!mayContainComponents(base)) return html;
  const collapsed = collapseFragment(base, registry, new Map());
  if (collapsed === base) return html;
  const stripped = stripManagedStyles(collapsed);
  // Expanding always reconciles, so a stale or hand-edited region comes back
  // reconciled; the baseline is therefore the reconciled input.
  const baseline = reconcileHtml(base, registry);
  if (expandComponentTags(stripped, registry).html === baseline) return stripped;
  if (expandComponentTags(collapsed, registry).html === baseline) return collapsed;
  return html;
}
